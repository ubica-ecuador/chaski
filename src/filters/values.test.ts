import type { RangeFilter } from '../engine/crossfilter';
import { pickedValues, rangeOf } from './values';

const values: Record<string, string | string[]> = {
  mag_lo: '4',
  mag_hi: '',
  kinds: ['$__all'],
  t0: '2026-10-01 00:00',
  t1: '',
};
const value = (name: string) => values[name];

describe('the variables’ values', () => {
  it('reads a multi-value variable, All being none', () => {
    expect(pickedValues(value, 'kinds')).toEqual([]);
    expect(pickedValues((n) => (n === 'k' ? ['a', ' ', 'b'] : undefined), 'k')).toEqual(['a', 'b']);
  });

  it('reads a range’s ends, a zoneless time as UTC', () => {
    const mag: RangeFilter = { name: 'mag', type: 'range', column: 'mag', from: 'mag_lo', to: 'mag_hi' };
    const when: RangeFilter = { name: 'when', type: 'range', column: 'time', from: 't0', to: 't1', as: 'time' };
    expect(rangeOf(mag, value)).toEqual([4, undefined]);
    expect(rangeOf(when, value)).toEqual([Date.UTC(2026, 9, 1), undefined]);
  });
});
