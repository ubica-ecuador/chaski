import { formatValue, roundToAxis } from './components/controls';

describe('roundToAxis', () => {
  it('rounds a number to the decimal of a pixel', () => {
    expect(roundToAxis(2.69999957085, 9, 280, false)).toBe(2.7);
    expect(roundToAxis(123.456, 4000, 280, false)).toBe(123);
  });

  it('rounds a time to the minute, hour or day', () => {
    const t = Date.UTC(2026, 8, 12, 13, 47, 31);
    expect(roundToAxis(t, 6 * 3_600_000, 280, true)).toBe(Date.UTC(2026, 8, 12, 13, 48));
    expect(roundToAxis(t, 30 * 86_400_000, 280, true)).toBe(Date.UTC(2026, 8, 12, 14));
    expect(roundToAxis(t, 2000 * 86_400_000, 280, true)).toBe(Date.UTC(2026, 8, 13));
  });
});

describe('formatValue', () => {
  it('shows a date at midnight, a time otherwise, and 4 significant digits', () => {
    expect(formatValue(Date.UTC(2026, 8, 1), true)).toBe('2026-09-01');
    expect(formatValue(Date.UTC(2026, 8, 1, 0, 7), true)).toBe('2026-09-01 00:07');
    expect(formatValue(393.64, false)).toBe('393.6');
    expect(formatValue(2e7, false)).toBe('2.00e+7');
  });
});
