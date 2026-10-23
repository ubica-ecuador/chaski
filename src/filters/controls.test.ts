import { formatBin, roundToAxis } from './components/controls';

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

describe('formatBin', () => {
  it('reads numbers to 3 digits, dates, and a time within a day', () => {
    expect(formatBin(2.5, 3, false)).toBe('2.5–3');
    expect(formatBin(Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 2), true)).toBe('2026-09-01 – 2026-09-02');
    expect(formatBin(Date.UTC(2026, 8, 1, 6), Date.UTC(2026, 8, 1, 7), true)).toBe('2026-09-01 06:00–07:00');
  });
});
