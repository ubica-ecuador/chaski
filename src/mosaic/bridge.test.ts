import { locationService } from '@grafana/runtime';
import { Param, Selection, clauseInterval, clauseIntervals, clauseMatch, clausePoints } from '@uwdata/mosaic-core';

import { extentToWkt, formatValue, linkVariables, parseLinks, PUBLISH_DELAY_MS, writesFor } from './bridge';

jest.mock('@grafana/runtime', () => ({ locationService: { partial: jest.fn() } }));
const partial = locationService.partial as jest.Mock;

const source = (name: string) => ({ name, reset: jest.fn() });

describe('parseLinks', () => {
  it('reads a YAML list', () => {
    expect(parseLinks('- param: brush\n  column: mag\n  from: lo\n  to: hi\n')).toEqual([
      { param: 'brush', column: 'mag', from: 'lo', to: 'hi' },
    ]);
    expect(parseLinks('')).toEqual([]);
  });

  it('says which entry is wrong', () => {
    expect(() => parseLinks('param: brush')).toThrow('must be a list');
    expect(() => parseLinks('- column: mag\n  from: lo')).toThrow('entry 1: `param`');
    expect(() => parseLinks('- param: brush')).toThrow('entry 1: give `from` and `to`, or `variable`');
  });
});

describe('values', () => {
  it('writes times as UTC ISO and numbers in full', () => {
    expect(formatValue(new Date(Date.UTC(2026, 9, 1, 12)))).toBe('2026-10-01T12:00:00.000Z');
    expect(formatValue(4.123456789)).toBe('4.123456789');
    expect(formatValue(null)).toBe('');
  });

  it('closes a 2-D extent as a WKT polygon', () => {
    expect(
      extentToWkt([
        [-80, -78],
        [-3, -1],
      ])
    ).toBe('POLYGON((-80 -3, -78 -3, -78 -1, -80 -1, -80 -3))');
  });
});

describe('writesFor', () => {
  it('reads each clause by its column', () => {
    const brush = Selection.crossfilter();
    brush.update(clauseInterval('mag', [4, 6.5], { source: source('mag') }));
    brush.update(
      clauseIntervals(
        ['lon', 'lat'],
        [
          [-80, -78],
          [-3, -1],
        ],
        { source: source('map') }
      )
    );
    brush.update(clausePoints(['alert'], [['red'], ['orange']], { source: source('alert') }));
    const params = new Map([['brush', brush]]);
    expect(
      writesFor(
        [
          { param: 'brush', column: 'mag', from: 'mag_lo', to: 'mag_hi' },
          { param: 'brush', column: ['lon', 'lat'], variable: 'area' },
          { param: 'brush', column: 'alert', variable: 'alerts' },
          { param: 'brush', column: 'depth', from: 'd_lo', to: 'd_hi' },
        ],
        params
      )
    ).toEqual({
      mag_lo: '4',
      mag_hi: '6.5',
      area: 'POLYGON((-80 -3, -78 -3, -78 -1, -80 -1, -80 -3))',
      alerts: ['red', 'orange'],
      d_lo: '',
      d_hi: '',
    });
  });

  it('takes the latest clause without a column, and a search as text', () => {
    const query = Selection.single();
    query.update(clauseMatch('place', 'Quito', { source: source('search') }));
    expect(writesFor([{ param: 'query', variable: 'q' }], new Map([['query', query]]))).toEqual({ q: 'Quito' });
  });

  it('writes a Param’s value, and skips params the spec lacks', () => {
    const params = new Map([['minmag', Param.value<unknown>(4.5)]]);
    expect(
      writesFor(
        [
          { param: 'minmag', variable: 'm' },
          { param: 'missing', variable: 'x' },
        ],
        params
      )
    ).toEqual({ m: '4.5' });
  });
});

describe('linkVariables', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    partial.mockClear();
  });
  afterEach(() => jest.useRealTimers());

  const setup = () => {
    const brush = Selection.crossfilter();
    const unlink = linkVariables(
      [{ param: 'brush', column: 'mag', from: 'lo', to: 'hi' }],
      new Map([['brush', brush]])
    );
    return { brush, unlink, mag: source('mag') };
  };

  it('writes once the brush rests, and only what changed', async () => {
    const { brush, mag } = setup();
    // Mosaic emits a selection's value events asynchronously, one after another.
    brush.update(clauseInterval('mag', [1, 2], { source: mag }));
    brush.update(clauseInterval('mag', [1, 3], { source: mag }));
    await jest.advanceTimersByTimeAsync(PUBLISH_DELAY_MS - 50);
    expect(partial).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(PUBLISH_DELAY_MS);
    expect(partial).toHaveBeenCalledTimes(1);
    expect(partial).toHaveBeenCalledWith({ 'var-lo': '1', 'var-hi': '3' }, true);

    brush.update(clauseInterval('mag', [1, 4], { source: mag }));
    await jest.advanceTimersByTimeAsync(PUBLISH_DELAY_MS);
    expect(partial).toHaveBeenLastCalledWith({ 'var-hi': '4' }, true);
  });

  it('flushes a pending write when asked, and drops it otherwise', async () => {
    let { brush, unlink, mag } = setup();
    brush.update(clauseInterval('mag', [1, 2], { source: mag }));
    await jest.advanceTimersByTimeAsync(10);
    unlink(true);
    expect(partial).toHaveBeenCalledWith({ 'var-lo': '1', 'var-hi': '2' }, true);

    partial.mockClear();
    ({ brush, unlink, mag } = setup());
    brush.update(clauseInterval('mag', [1, 2], { source: mag }));
    await jest.advanceTimersByTimeAsync(10);
    unlink(false);
    await jest.advanceTimersByTimeAsync(PUBLISH_DELAY_MS);
    expect(partial).not.toHaveBeenCalled();
  });
});
