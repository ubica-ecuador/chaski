import { paintRange, paintValues } from './paint';
import type { IntervalInteractor, ToggleInteractor } from './sync';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A plot as Plot draws a control: a grey layer and the coloured one, which takes no pointer events. */
function plot(rects: Array<{ x?: number; y?: number }>, mark = 'rect') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'plot-1');
  for (const pointer of [null, 'none']) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('aria-label', mark);
    if (pointer) {
      g.setAttribute('pointer-events', pointer);
    }
    for (const r of rects) {
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(r.x ?? 0));
      rect.setAttribute('y', String(r.y ?? 0));
      g.appendChild(rect);
    }
    svg.appendChild(g);
  }
  return svg;
}

const coloured = (element: HTMLElement) => element.querySelector('g[pointer-events="none"]')!;
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

function brushed(value?: number[]) {
  const listeners = new Map<string, ((event: { selection: [number, number] | null }) => void) | null>();
  const interactor = {
    value,
    scale: { apply: (v: unknown) => Number(v) * 10 },
    brush: {
      moveSilent: undefined,
      on: (type: string, listener: ((event: { selection: [number, number] | null }) => void) | null) =>
        type.split(' ').forEach((t) => listeners.set(t, listener)),
    },
  } as unknown as IntervalInteractor;
  const move = (selection: [number, number] | null) => {
    for (const [type, listener] of listeners) {
      if (type.startsWith('brush.')) {
        listener?.({ selection });
      }
    }
  };
  return { interactor, listeners, move };
}

describe('paintRange', () => {
  it('clips the coloured bars to the range the brush holds, and shows them whole when it holds none', () => {
    const element = document.createElement('div');
    element.appendChild(plot([{ x: 0 }]));
    const { interactor } = brushed([2, 5]);
    const painter = paintRange(element, interactor);
    painter.paint();
    const id = coloured(element).getAttribute('clip-path')!.slice(5, -1);
    const rect = element.querySelector(`#${id} rect`)!;
    expect([rect.getAttribute('x'), rect.getAttribute('width')]).toEqual(['20', '30']);
    interactor.value = undefined;
    painter.paint();
    expect(coloured(element).hasAttribute('clip-path')).toBe(false);
    painter.stop();
  });

  it('follows the brush as it moves, from the pixels it reports, and stops listening when stopped', () => {
    const element = document.createElement('div');
    element.appendChild(plot([{ x: 0 }]));
    const { interactor, listeners, move } = brushed();
    const painter = paintRange(element, interactor);
    move([70, 40]);
    const id = coloured(element).getAttribute('clip-path')!.slice(5, -1);
    const rect = element.querySelector(`#${id} rect`)!;
    expect([rect.getAttribute('x'), rect.getAttribute('width')]).toEqual(['40', '30']);
    move(null);
    expect(coloured(element).hasAttribute('clip-path')).toBe(false);
    painter.stop();
    expect([...listeners.values()].every((l) => l === null)).toBe(true);
  });

  it('paints again when Mosaic draws the plot again', async () => {
    const element = document.createElement('div');
    element.appendChild(plot([{ x: 0 }]));
    const { interactor } = brushed([1, 2]);
    const painter = paintRange(element, interactor);
    element.replaceChildren(plot([{ x: 0 }]));
    await nextTick();
    expect(coloured(element).getAttribute('clip-path')).toMatch(/^url\(#chaski-paint-\d+\)$/);
    painter.stop();
  });
});

describe('paintValues', () => {
  const bands: Record<string, number> = { earthquake: 4, explosion: 24, 'ice quake': 44 };
  const drawn = () => {
    // Plot draws a bar per row at its band's top plus the inset.
    const svg = plot(
      Object.values(bands).map((at) => ({ y: at + 2 })),
      'bar'
    ) as SVGSVGElement & { scale?: unknown };
    svg.scale = () => ({ domain: Object.keys(bands), apply: (v: string) => bands[v] });
    return svg;
  };
  const shown = (element: HTMLElement) =>
    Array.from(coloured(element).querySelectorAll('rect')).map((r) => r.getAttribute('display') !== 'none');

  it('keeps the coloured bars of the values picked, and all of them when none is', async () => {
    const element = document.createElement('div');
    element.appendChild(drawn());
    const toggle = { value: [['explosion']] } as unknown as ToggleInteractor;
    const painter = paintValues(element, [toggle]);
    painter.paint();
    expect(shown(element)).toEqual([false, true, false]);
    toggle.value = null;
    painter.paint();
    expect(shown(element)).toEqual([true, true, true]);
    toggle.value = [['earthquake'], ['ice quake']];
    element.replaceChildren(drawn());
    await nextTick();
    expect(shown(element)).toEqual([true, false, true]);
    painter.stop();
  });
});
