import { formatAge, staleNotices } from './notices';

describe('formatAge', () => {
  it('reads like a person would say it', () => {
    expect(formatAge(42_000)).toBe('42 s');
    expect(formatAge(4 * 60_000)).toBe('4 min');
    expect(formatAge(3 * 3_600_000)).toBe('3 h');
  });
});

describe('staleNotices', () => {
  const fresh = { dashboard: 'd', name: 'lamp', table: 'd1_lamp_v2', version: 2, loadedAt: 0, rows: 1 };
  const stale = {
    dashboard: 'd',
    name: 'vehicles',
    table: 'd1_vehicles_v3',
    version: 3,
    loadedAt: 1_000,
    rows: 1,
    stale: { error: 'HTTP 503', failedAt: 241_000 },
  };

  it('warns only on frames that read a stale dataset', () => {
    expect(staleNotices([fresh, stale], 'SELECT * FROM "d1_vehicles_v3"', 241_000)).toEqual([
      { severity: 'warning', text: 'vehicles: data from 4 min ago — the reload failed (HTTP 503)' },
    ]);
    expect(staleNotices([fresh, stale], 'SELECT * FROM "d1_lamp_v2"', 241_000)).toEqual([]);
  });
});
