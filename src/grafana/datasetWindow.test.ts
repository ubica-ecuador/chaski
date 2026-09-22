import { dateTime, type TimeRange } from '@grafana/data';

import { rangeOf, scopedTimeOf, windowOf } from './datasetWindow';

describe('windowOf', () => {
  const from = dateTime(Date.UTC(2026, 0, 1));
  const to = dateTime(Date.UTC(2026, 0, 2));

  it('keeps relative raw bounds as text', () => {
    expect(windowOf({ from, to, raw: { from: 'now-1d', to: 'now' } })).toEqual({
      from: from.valueOf(),
      to: to.valueOf(),
      rawFrom: 'now-1d',
      rawTo: 'now',
    });
  });

  it('turns absolute raw bounds into epoch ms', () => {
    expect(windowOf({ from, to, raw: { from, to } })).toEqual({
      from: from.valueOf(),
      to: to.valueOf(),
      rawFrom: from.valueOf(),
      rawTo: to.valueOf(),
    });
  });

  it('falls back to the evaluated bounds when the range has no raw part', () => {
    const window = { from: from.valueOf(), to: to.valueOf(), rawFrom: from.valueOf(), rawTo: to.valueOf() };
    expect(windowOf({ from, to } as TimeRange)).toEqual(window);
    expect(windowOf({ from, to, raw: {} } as TimeRange)).toEqual(window);
  });
});

describe('rangeOf', () => {
  it('rebuilds a TimeRange with the same instants', () => {
    const range = rangeOf({ from: 10, to: 20, rawFrom: 'now-1h', rawTo: 'now' });
    expect([range.from.valueOf(), range.to.valueOf()]).toEqual([10, 20]);
  });
});

describe('scopedTimeOf', () => {
  it('pins __from and __to to the window', () => {
    expect(scopedTimeOf({ from: 10, to: 20, rawFrom: 10, rawTo: 20 })).toEqual({
      __from: { text: '10', value: 10 },
      __to: { text: '20', value: 20 },
    });
  });
});
