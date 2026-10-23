import { Selection, clauseInterval } from '@uwdata/mosaic-core';

import { writesFor } from './bridge';
import { linkReads, parseReads, predicateFor, wktRing, type ReadValue } from './inbound';

jest.mock('@grafana/runtime', () => ({ locationService: {} }));

const urlOf =
  (vars: Record<string, string | string[]>): ReadValue =>
  (name) =>
    [vars[name] ?? []].flat().filter((v) => v !== '');

describe('parseReads', () => {
  it('reads a YAML list', () => {
    expect(parseReads('- param: b\n  column: lon\n  from: west\n  to: east\n')).toEqual([
      { param: 'b', column: 'lon', from: 'west', to: 'east' },
    ]);
  });

  it('says what is wrong, and refuses what the panel writes itself', () => {
    expect(() => parseReads('- param: b\n  column: lon')).toThrow('give `from` and `to`, `area` or `values`');
    expect(() => parseReads('- param: b\n  column: lon\n  area: a')).toThrow('two columns');
    expect(() => parseReads('- param: b\n  column: x\n  from: lo', new Set(['lo']))).toThrow('this panel writes `lo`');
  });
});

describe('predicateFor', () => {
  it('makes a range, open where an end is empty, of numbers or times', () => {
    const read = { param: 'b', column: 'lon', from: 'west', to: 'east' };
    expect(String(predicateFor(read, urlOf({ west: '-74', east: '-73.9' }))!.predicate)).toBe(
      '("lon" BETWEEN -74 AND -73.9)'
    );
    expect(String(predicateFor(read, urlOf({ west: '-74' }))!.predicate)).toBe('("lon" >= -74)');
    expect(predicateFor(read, urlOf({}))).toBeNull();
    const t = predicateFor({ param: 'b', column: 't', from: 't0' }, urlOf({ t0: '2026-01-01T00:00:00.000Z' }));
    expect(t!.value).toEqual([new Date('2026-01-01T00:00:00.000Z'), undefined]);
  });

  it('makes an area a point-in-polygon behind its bounding box, from the numbers alone', () => {
    const read = { param: 'b', column: ['px', 'py'], area: 'area' };
    const made = predicateFor(
      read,
      urlOf({ area: "POLYGON((-74 40.7, -73.9 40.7, -73.9 40.8, -74 40.7)); DROP TABLE x;--'" })
    );
    const text = String(made!.predicate);
    expect(text).toContain('"px" BETWEEN -74 AND -73.9');
    expect(text).toContain('"py" BETWEEN 40.7 AND 40.8');
    expect(text).toContain("ST_GeomFromText('POLYGON((-74 40.7, -73.9 40.7, -73.9 40.8, -74 40.7))')");
    expect(text).not.toContain('DROP');
    expect(wktRing('LINESTRING(0 0, 1 1, 2 2)')).toEqual([]);
  });

  it('keeps the values of a multi-value variable', () => {
    const made = predicateFor({ param: 'b', column: 'pay', values: 'pay' }, urlOf({ pay: ['CSH', 'CRD'] }));
    expect(String(made!.predicate)).toBe(`("pay" IN ('CSH', 'CRD'))`);
  });
});

describe('linkReads', () => {
  it('keeps a clause in step with the variables, and takes it out when stopped', async () => {
    const brush = Selection.crossfilter();
    const vars: Record<string, string> = { west: '-74', east: '-73.9' };
    let changed = () => {};
    const stop = linkReads(
      [{ param: 'brush', column: 'lon', from: 'west', to: 'east' }],
      new Map([['brush', brush]]),
      urlOf(vars),
      (cb) => {
        changed = cb;
        return () => {};
      }
    );
    expect(brush.clauses).toHaveLength(1);
    vars.west = '';
    vars.east = '';
    changed();
    expect(brush.clauses).toHaveLength(0);
    vars.west = '-75';
    changed();
    expect(String(brush.clauses[0].predicate)).toBe('("lon" >= -75)');
    stop();
    expect(brush.clauses).toHaveLength(0);
  });

  it('is never written back by the outbound links', () => {
    const brush = Selection.crossfilter();
    linkReads(
      [{ param: 'brush', column: ['px', 'py'], area: 'area' }],
      new Map([['brush', brush]]),
      urlOf({ area: 'POLYGON((0 0, 1 0, 1 1, 0 0))' }),
      () => () => {}
    );
    brush.update(clauseInterval('fare', [5, 10], { source: {} }));
    expect(
      writesFor([{ param: 'brush', column: ['px', 'py'], variable: 'pickup' }], new Map([['brush', brush]]))
    ).toEqual({ pickup: '' });
  });
});
