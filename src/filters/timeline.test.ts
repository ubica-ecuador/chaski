import { parseSpec } from '@uwdata/mosaic-spec';

import type { FilterDeclaration } from '../engine/crossfilter';
import {
  type ActivityState,
  formatWindow,
  nextWindow,
  paced,
  play,
  type Player,
  previousWindow,
  startWindow,
  stepOf,
  timelineFilter,
  timelineSpec,
} from './timeline';

const look = { colour: '#3d71d9', paint: 'url(#g)', muted: '#444', text: '#ccc', width: 1100 };
const filters: FilterDeclaration[] = [
  { name: 'mag', type: 'range', column: 'mag', from: 'mag_lo', to: 'mag_hi' },
  { name: 'kind', type: 'in', column: 'type', variable: 'kinds' },
  { name: 'when', type: 'range', column: 'time', from: 't0', to: 't1', as: 'time' },
];

describe('timelineFilter', () => {
  it('takes the range filter named, over numbers too', () => {
    expect(timelineFilter(filters, 'mag')?.name).toBe('mag');
  });

  it('takes the first range filter over times when none is named', () => {
    expect(timelineFilter(filters, ' ')?.name).toBe('when');
  });

  it('finds none for a name that is not a range filter, or a dataset with no times', () => {
    expect(timelineFilter(filters, 'kind')).toBeUndefined();
    expect(timelineFilter(filters.slice(0, 2), '')).toBeUndefined();
  });
});

describe('timelineSpec', () => {
  const when = timelineFilter(filters, '')!;

  it('is the filter histogram, at the panel height, with a tick per 110 px', () => {
    const spec = timelineSpec('quakes', when, 'quakeFilters', 120, look, 90);
    expect(() => parseSpec(spec as never)).not.toThrow();
    expect(spec.plot[1]).toMatchObject({ select: 'intervalX', as: '$quakeFilters' });
    expect(spec).toMatchObject({ height: 90, xTicks: 10, width: 1100 });
  });

  it('keeps room for its bars in a low panel', () => {
    expect(timelineSpec('quakes', when, 'quakeFilters', 120, { ...look, width: 200 }, 10)).toMatchObject({
      height: 48,
      xTicks: 3,
    });
  });
});

describe('play steps', () => {
  const domain: [number, number] = [0, 100];

  it('starts from the window held, or from the start once it reached the end', () => {
    expect(startWindow(domain, 5, 'slide', [20, 40])).toEqual([20, 40]);
    expect(startWindow(domain, 5, 'slide', [80, 100])).toEqual([0, 20]);
    expect(startWindow(domain, 5, 'grow', [80, 100])).toEqual([0, 5]);
  });

  it('starts a slide a tenth of the axis wide, in whole steps, and a grow one step wide', () => {
    expect(startWindow(domain, 3, 'slide')).toEqual([0, 9]);
    expect(startWindow(domain, 40, 'slide')).toEqual([0, 40]);
    expect(startWindow(domain, 5, 'grow')).toEqual([0, 5]);
  });

  it('slides a step at a time, the last step clamped to the end, then stops', () => {
    expect(nextWindow(domain, [20, 40], 5, 'slide')).toEqual([25, 45]);
    expect(nextWindow(domain, [78, 98], 5, 'slide')).toEqual([80, 100]);
    expect(nextWindow(domain, [80, 100], 5, 'slide')).toBeUndefined();
  });

  it('grows the end a step at a time and keeps the start', () => {
    expect(nextWindow(domain, [0, 5], 5, 'grow')).toEqual([0, 10]);
    expect(nextWindow(domain, [0, 98], 5, 'grow')).toEqual([0, 100]);
    expect(nextWindow(domain, [0, 100], 5, 'grow')).toBeUndefined();
  });

  it('steps back to the start, and a grow down to one step', () => {
    expect(previousWindow(domain, [20, 40], 5, 'slide')).toEqual([15, 35]);
    expect(previousWindow(domain, [2, 22], 5, 'slide')).toEqual([0, 20]);
    expect(previousWindow(domain, [0, 20], 5, 'slide')).toBeUndefined();
    expect(previousWindow(domain, [0, 20], 5, 'grow')).toEqual([0, 15]);
    expect(previousWindow(domain, [0, 5], 5, 'grow')).toBeUndefined();
  });

  it('is not thrown by the rounding of times in floating point', () => {
    const day = 86_400_000;
    const start = Date.UTC(2026, 0, 1);
    const end = start + 0.1 * 3 * day;
    expect(nextWindow([start, end], [start, end - 1e-3], 0.1 * day, 'slide')).toBeUndefined();
  });
});

describe('stepOf', () => {
  const columns = (x1: unknown[], x2: unknown[]) => ({
    channels: [
      { channel: 'x1', as: 'x1' },
      { channel: 'x2', as: 'x2' },
    ],
    data: { columns: { x1, x2 } },
  });

  it('reads the bin size the mark drew, times included', () => {
    expect(stepOf(columns([10, 12], [12, 14]), [0, 100], 40)).toBe(2);
    expect(stepOf(columns([new Date(0)], [new Date(3_600_000)]), [0, 1], 40)).toBe(3_600_000);
  });

  it('takes the axis over the bins asked for until the mark has drawn', () => {
    expect(stepOf(undefined, [0, 100], 40)).toBe(2.5);
    expect(stepOf(columns([], []), [0, 100], 50)).toBe(2);
  });
});

describe('paced', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const bus = () => {
    const listeners = new Set<(state: ActivityState) => void>();
    return {
      listen: (listener: (state: ActivityState) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      say: (state: ActivityState) => listeners.forEach((l) => l(state)),
      size: () => listeners.size,
    };
  };
  const track = (promise: Promise<void>) => {
    const state = { done: false };
    promise.then(() => (state.done = true));
    return state;
  };

  it('waits its time when nothing runs', async () => {
    const { listen, size } = bus();
    const step = track(paced(800, 5000, listen, new AbortController().signal));
    await jest.advanceTimersByTimeAsync(799);
    expect(step.done).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(step.done).toBe(true);
    expect(size()).toBe(0);
  });

  it('waits past its time for the queries the step set off', async () => {
    const { listen, say } = bus();
    const step = track(paced(800, 5000, listen, new AbortController().signal));
    await jest.advanceTimersByTimeAsync(300);
    say('busy');
    await jest.advanceTimersByTimeAsync(1000);
    expect(step.done).toBe(false);
    say('settled');
    await jest.advanceTimersByTimeAsync(0);
    expect(step.done).toBe(true);
  });

  it('waits no longer than its cap, and not at all once aborted', async () => {
    const { listen, say } = bus();
    const capped = track(paced(800, 2000, listen, new AbortController().signal));
    say('busy');
    await jest.advanceTimersByTimeAsync(2800);
    expect(capped.done).toBe(true);

    const abort = new AbortController();
    const stopped = track(paced(800, 2000, listen, abort.signal));
    abort.abort();
    await jest.advanceTimersByTimeAsync(0);
    expect(stopped.done).toBe(true);
  });
});

describe('play', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const quiet = () => () => {};
  const brush = (held?: [number, number]): Player & { moves: Array<[number, number]> } => {
    let window = held;
    const moves: Array<[number, number]> = [];
    return {
      moves,
      domain: () => [0, 10],
      step: () => 2,
      held: () => window,
      set: (next) => {
        window = next;
        moves.push(next);
      },
      settled: () => Promise.resolve(),
    };
  };

  it('moves the brush a step each beat, to the end', async () => {
    const player = brush([0, 4]);
    const done = play(player, 'slide', 500, quiet, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(500 * 4);
    await done;
    expect(player.moves).toEqual([
      [0, 4],
      [2, 6],
      [4, 8],
      [6, 10],
    ]);
  });

  it('stops where it got to once aborted', async () => {
    const player = brush();
    const abort = new AbortController();
    const done = play(player, 'grow', 500, quiet, abort.signal);
    await jest.advanceTimersByTimeAsync(500);
    abort.abort();
    await done;
    expect(player.moves).toEqual([
      [0, 2],
      [0, 4],
    ]);
  });

  it('waits for the controls to draw each step', async () => {
    const player = brush([0, 2]);
    let release = () => {};
    player.settled = () => new Promise((resolve) => (release = resolve));
    const abort = new AbortController();
    void play(player, 'slide', 100, quiet, abort.signal);
    await jest.advanceTimersByTimeAsync(1000);
    expect(player.moves).toHaveLength(1);
    release();
    await jest.advanceTimersByTimeAsync(0);
    expect(player.moves).toHaveLength(2);
    abort.abort();
  });
});

describe('formatWindow', () => {
  const at = (iso: string) => Date.parse(iso);

  it('shows dates, and the minute of an end that is not midnight', () => {
    expect(formatWindow([at('2026-09-04T00:00Z'), at('2026-09-07T00:00Z')], true)).toBe('2026-09-04 – 2026-09-07');
    expect(formatWindow([at('2026-09-04T12:00Z'), at('2026-09-07T12:00Z')], true)).toBe(
      '2026-09-04 12:00 – 2026-09-07 12:00'
    );
  });

  it('shows a window within a day as its date and two times, and numbers to 4 digits', () => {
    expect(formatWindow([at('2026-09-04T06:00Z'), at('2026-09-04T18:30Z')], true)).toBe('2026-09-04 06:00–18:30');
    expect(formatWindow([2.123456, 7], false)).toBe('2.123 – 7');
  });
});
