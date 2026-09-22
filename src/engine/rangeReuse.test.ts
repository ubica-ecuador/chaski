import { decideDatasetLoad, type LoadedWindow, type LoadWindow, type NextLoad } from './rangeReuse';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 8, 1);

const abs = (from: number, to: number): LoadWindow => ({ from, to, rawFrom: from, rawTo: to });
const rel = (from: number, to: number, rawFrom: string, rawTo = 'now'): LoadWindow => ({ from, to, rawFrom, rawTo });
const loaded = (window: LoadWindow, extra: Partial<LoadedWindow> = {}): LoadedWindow => ({
  window,
  signature: 'sig',
  visit: 1,
  stale: false,
  ...extra,
});
const next = (window: LoadWindow, extra: Partial<NextLoad> = {}): NextLoad => ({
  window,
  signatureAtLoadedWindow: 'sig',
  visit: 1,
  loading: false,
  ...extra,
});

describe('decideDatasetLoad', () => {
  it('loads when nothing is loaded yet', () => {
    expect(decideDatasetLoad(undefined, next(abs(T0, T0 + DAY)))).toBe('load');
  });

  it('reuses on an absolute zoom-in', () => {
    expect(decideDatasetLoad(loaded(abs(T0, T0 + 10 * DAY)), next(abs(T0 + DAY, T0 + 2 * DAY)))).toBe('reuse');
  });

  it('reuses the same instants asked for with different raw values', () => {
    expect(decideDatasetLoad(loaded(abs(T0, T0 + DAY)), next(rel(T0, T0 + DAY, 'now-1d')))).toBe('reuse');
  });

  it('loads on a zoom-out past either bound', () => {
    const inside = loaded(abs(T0 + DAY, T0 + 2 * DAY));
    expect(decideDatasetLoad(inside, next(abs(T0, T0 + 2 * DAY)))).toBe('load');
    expect(decideDatasetLoad(inside, next(abs(T0 + DAY, T0 + 3 * DAY)))).toBe('load');
  });

  it('loads on a refresh: same raw range, even though the evaluated bounds moved', () => {
    const before = loaded(rel(T0, T0 + 7 * DAY, 'now-7d'));
    expect(decideDatasetLoad(before, next(rel(T0 + 60_000, T0 + 7 * DAY + 60_000, 'now-7d')))).toBe('load');
  });

  it('reuses a narrower preset when both end at now, although now has moved on', () => {
    const week = loaded(rel(T0, T0 + 7 * DAY, 'now-7d'));
    const fiveMinutesLater = T0 + 7 * DAY + 300_000;
    expect(decideDatasetLoad(week, next(rel(fiveMinutesLater - DAY, fiveMinutesLater, 'now-24h')))).toBe('reuse');
  });

  it('loads a window ending at now that starts after the loaded one ended', () => {
    const week = loaded(rel(T0, T0 + 7 * DAY, 'now-7d'));
    const fiveHoursLater = T0 + 7 * DAY + 5 * HOUR;
    expect(decideDatasetLoad(week, next(rel(fiveHoursLater - HOUR, fiveHoursLater, 'now-1h')))).toBe('load');
    const touching = T0 + 7 * DAY + HOUR;
    expect(decideDatasetLoad(week, next(rel(touching - HOUR, touching, 'now-1h')))).toBe('load');
  });

  it('gives no such allowance to an end that is not exactly now', () => {
    const toToday = loaded(rel(T0, T0 + 7 * DAY, 'now-7d', 'now/d'));
    expect(decideDatasetLoad(toToday, next(rel(T0 + DAY, T0 + 7 * DAY + 1, 'now-6d', 'now/d')))).toBe('load');
  });

  it('loads when the source changed for another reason', () => {
    const decision = decideDatasetLoad(
      loaded(abs(T0, T0 + 10 * DAY)),
      next(abs(T0 + DAY, T0 + 2 * DAY), { signatureAtLoadedWindow: 'other' })
    );
    expect(decision).toBe('load');
  });

  it('loads when the signature could not be computed', () => {
    const decision = decideDatasetLoad(
      loaded(abs(T0, T0 + 10 * DAY)),
      next(abs(T0 + DAY, T0 + 2 * DAY), { signatureAtLoadedWindow: undefined })
    );
    expect(decision).toBe('load');
  });

  it('loads while another load of the dataset is in flight', () => {
    const decision = decideDatasetLoad(
      loaded(abs(T0, T0 + 10 * DAY)),
      next(abs(T0 + DAY, T0 + 2 * DAY), { loading: true })
    );
    expect(decision).toBe('load');
  });

  it('never reuses a table left over from a failed reload', () => {
    const decision = decideDatasetLoad(
      loaded(abs(T0, T0 + 10 * DAY), { stale: true }),
      next(abs(T0 + DAY, T0 + 2 * DAY))
    );
    expect(decision).toBe('load');
  });

  it('never reuses a table from an earlier visit to the dashboard', () => {
    const decision = decideDatasetLoad(
      loaded(abs(T0, T0 + 10 * DAY), { visit: 1 }),
      next(abs(T0 + DAY, T0 + 2 * DAY), { visit: 2 })
    );
    expect(decision).toBe('load');
  });
});
