import { roundToAxis } from './components/controls';

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
