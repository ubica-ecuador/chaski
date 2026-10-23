import type { Clause, DeclaredDataset } from '../engine/crossfilter';
import { type ExtentCache, loadPanelData, pickedValues, rangeOf, type Row } from './load';

const dataset: DeclaredDataset = {
  name: 'quakes',
  table: 't_1',
  filters: [
    { name: 'mag', type: 'range', column: 'mag', from: 'mag_lo', to: 'mag_hi' },
    { name: 'when', type: 'range', column: 'time', from: 't0', to: 't1', as: 'time' },
    { name: 'kind', type: 'in', column: 'type', variable: 'kinds' },
    { name: 'drawn', type: 'area', variable: 'area', lat: 'lat', lng: 'lng' },
  ],
};
const states: Clause[] = [
  { name: 'mag', label: 'mag', sql: '"mag" >= 4', text: '≥ 4', variables: ['mag_lo', 'mag_hi'] },
  { name: 'when', label: 'when', sql: undefined, text: '', variables: ['t0', 't1'] },
  { name: 'kind', label: 'kind', sql: undefined, text: '', variables: ['kinds'] },
  { name: 'drawn', label: 'drawn', sql: undefined, text: '', variables: ['area'] },
];
const values: Record<string, string | string[]> = {
  mag_lo: '4',
  mag_hi: '',
  kinds: ['$__all'],
  t0: '2026-10-01 00:00',
  t1: '',
};
const value = (name: string) => values[name];

/** Answers each query by what it asks for. */
function fakeRun(log: string[]) {
  return async (sql: string): Promise<Row[]> => {
    log.push(sql);
    if (sql.includes('AS shown')) {
      return [{ total: 100, shown: 40, without_mag: 100 }];
    }
    if (sql.startsWith('SELECT min(')) {
      return sql.includes('epoch_ms') ? [{ lo: null, hi: null }] : [{ lo: 0, hi: 8 }];
    }
    if (sql.includes(' AS bin')) {
      return [
        { bin: 0, n: 3, total: 5 },
        { bin: 3, n: 7, total: 7 },
      ];
    }
    if (sql.includes(' AS value')) {
      return [{ value: 'earthquake', n: 30, total: 90 }];
    }
    throw new Error(`unexpected ${sql}`);
  };
}

describe('loadPanelData', () => {
  it('reads the counts, the values and the histograms', async () => {
    const log: string[] = [];
    const extents: ExtentCache = new Map();
    const data = await loadPanelData(fakeRun(log), dataset, states, value, [], { maxValues: 4, bins: 4 }, extents);
    expect(data.total).toBe(100);
    expect(data.shown).toBe(40);
    expect(data.without).toEqual({ mag: 100 });
    expect(data.values.kind).toEqual([{ value: 'earthquake', n: 30, total: 90 }]);
    expect(data.histograms.mag).toEqual({ extent: { lo: 0, hi: 8 }, n: [3, 0, 0, 7], total: [5, 0, 0, 7] });
    // A column with no values has no histogram.
    expect(data.histograms.when).toBeUndefined();
    expect(log.filter((q) => q.includes(' AS value'))[0]).toMatch(/LIMIT 100$/);

    // The extents are read once per table.
    const again: string[] = [];
    await loadPanelData(fakeRun(again), dataset, states, value, [], { maxValues: 4, bins: 4 }, extents);
    expect(again.some((q) => q.startsWith('SELECT min('))).toBe(false);
  });
});

describe('the variables’ values', () => {
  it('reads a multi-value variable, All being none', () => {
    expect(pickedValues(value, 'kinds')).toEqual([]);
    expect(pickedValues((n) => (n === 'k' ? ['a', ' ', 'b'] : undefined), 'k')).toEqual(['a', 'b']);
  });

  it('reads a range’s ends, a zoneless time as UTC', () => {
    expect(rangeOf(dataset.filters[0] as never, value)).toEqual([4, undefined]);
    expect(rangeOf(dataset.filters[1] as never, value)).toEqual([Date.UTC(2026, 9, 1), undefined]);
  });
});
