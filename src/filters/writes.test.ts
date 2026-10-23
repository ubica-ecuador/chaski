import { clearing, formatEnd, rangeWrites, valuesWrites } from './writes';

describe('writes', () => {
  it('writes numbers to 12 significant digits and times as UTC ISO', () => {
    expect(formatEnd(1 / 3, false)).toBe('0.333333333333');
    expect(formatEnd(Date.UTC(2026, 0, 2, 3, 4, 5, 600.4), true)).toBe('2026-01-02T03:04:05.600Z');
    expect(formatEnd(undefined, false)).toBe('');
  });

  it('sets a range or clears it', () => {
    expect(rangeWrites('lo', 'hi', [1, 2.5], false)).toEqual({ lo: '1', hi: '2.5' });
    expect(rangeWrites('lo', 'hi', undefined, false)).toEqual({ lo: '', hi: '' });
  });

  it('sets the values picked, or empties the variable', () => {
    expect(valuesWrites('k', ['a', 'b'])).toEqual({ k: ['a', 'b'] });
    expect(valuesWrites('k', [])).toEqual({ k: '' });
    expect(clearing(['a', 'b'])).toEqual({ a: '', b: '' });
  });
});
