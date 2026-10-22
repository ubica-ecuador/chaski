/** @jest-environment node */
import {
  type CrossfilterSource,
  crossfilterSql,
  type DeclaredDataset,
  type FilterDeclaration,
  filtersSql,
  filtersValue,
  normalizeFilters,
} from './crossfilter';
import { createNodeRunner } from './testing/nodeRunner';
import type { SqlRunner } from './types';

/** How `$quakeFilters` reaches the macro once Chaski has quoted it. */
const QUAKES = "'quakes#00c0ffee'";
const EXPOSURE = "'exposure#00c0ffee'";

const QUAKE_FILTERS: FilterDeclaration[] = [
  { name: 'time', type: 'range', column: 'time', as: 'time', from: 'quakeFrom', to: 'quakeTo', upper: 'closed' },
  { name: 'mag', type: 'range', column: 'mag', from: 'mag_lo', to: 'mag_hi', label: 'Magnitude' },
  { name: 'depth', type: 'range', column: 'depth_axis', from: 'depth_lo', to: 'depth_hi' },
  { name: 'area', type: 'area', variable: 'quakeArea', lat: 'latitude', lng: 'longitude' },
  { name: 'alert', type: 'in', column: 'alert', variable: 'alerts' },
];

const EMPTY = {
  quakeFrom: '',
  quakeTo: '',
  mag_lo: '',
  mag_hi: '',
  depth_lo: '',
  depth_hi: '',
  quakeArea: '',
  alerts: [],
};

function sourceOf(values: Record<string, string | string[]>, datasets: DeclaredDataset[]): CrossfilterSource {
  return {
    dataset: (name) => datasets.find((d) => d.name === name),
    value: (name) => (name in values ? values[name] : undefined),
  };
}

const quakes = (filters = QUAKE_FILTERS): DeclaredDataset => ({ name: 'quakes', table: 'd1_quakes_v1', filters });

describe('normalizeFilters', () => {
  const value = (name: string) => ({ mag_lo: '', quakeFilters: 'quakes#1a2b3c4d' })[name];

  it('reads each $name as the variable, and a link to a filters variable as its dataset', () => {
    expect(
      normalizeFilters(
        'exposure',
        [
          { name: 'mag', type: 'range', column: 'mag', from: '$mag_lo', to: '${mag_hi}' },
          { name: 'quakes', type: 'link', column: 'id', filters: '$quakeFilters', to: 'id' },
        ],
        value
      )
    ).toEqual([
      { name: 'mag', type: 'range', column: 'mag', from: 'mag_lo', to: 'mag_hi' },
      { name: 'quakes', type: 'link', column: 'id', dataset: 'quakes', to: 'id' },
    ]);
  });

  it('refuses a variable without $, which Grafana would not follow', () => {
    expect(() =>
      normalizeFilters('quakes', [{ name: 'mag', type: 'range', column: 'mag', from: 'mag_lo', to: '$mag_hi' }], value)
    ).toThrow('Filter mag of dataset quakes must name its variable as $mag_lo');
  });

  it('refuses a bad declaration with a message that says which', () => {
    const one = (filter: Record<string, string>) => () => normalizeFilters('quakes', [filter], value);
    expect(() => normalizeFilters('quakes', {}, value)).toThrow('needs a list of filters');
    expect(one({ type: 'in', column: 'c', variable: '$v' })).toThrow('A filter of dataset quakes needs a name');
    expect(one({ name: 'x', type: 'circle' })).toThrow('Filter x of dataset quakes has an unknown type: circle');
    expect(one({ name: 'x', type: 'in', variable: '$v' })).toThrow('Filter x of dataset quakes needs column');
    expect(one({ name: 'x', type: 'link', column: 'id', filters: '$mag_lo', to: 'id' })).toThrow(
      'links to $mag_lo, which is not a filters variable'
    );
    const twice = { name: 'x', type: 'in', column: 'c', variable: '$v' };
    expect(() => normalizeFilters('quakes', [twice, twice], value)).toThrow('declares the filter x twice');
  });
});

describe('filtersValue', () => {
  it('changes with the filters, and only with them', () => {
    const at = (values: Record<string, string | string[]>) => filtersValue(quakes(), sourceOf(values, [quakes()]));
    expect(at(EMPTY)).toMatch(/^quakes#[0-9a-f]{8}$/);
    expect(at({ ...EMPTY, mag_lo: '5' })).not.toBe(at(EMPTY));
    expect(at({ ...EMPTY, mag_lo: '5' })).toBe(at({ ...EMPTY, mag_lo: '5.0' }));
    expect(at({ ...EMPTY, mag_lo: 'not a number' })).toBe(at(EMPTY));
  });
});

describe('crossfilterSql', () => {
  it('is (TRUE) while no filter is active', () => {
    expect(crossfilterSql([QUAKES], sourceOf(EMPTY, [quakes()]))).toBe('(TRUE)');
  });

  it('ANDs the active filters and leaves out each -name', () => {
    const source = sourceOf({ ...EMPTY, mag_lo: '4.5', mag_hi: '6', depth_lo: '0', depth_hi: '70' }, [quakes()]);
    expect(crossfilterSql([QUAKES], source)).toBe(
      '(TRUE AND "mag" >= 4.5 AND "mag" < 6 AND "depth_axis" >= 0 AND "depth_axis" < 70)'
    );
    expect(crossfilterSql([QUAKES, '-mag'], source)).toBe('(TRUE AND "depth_axis" >= 0 AND "depth_axis" < 70)');
    expect(crossfilterSql([QUAKES, '-mag', ' - depth '], source)).toBe('(TRUE)');
  });

  it('reads a range with one end empty as open on that side, and times as UTC ISO strings', () => {
    const source = sourceOf({ ...EMPTY, mag_hi: '6', quakeFrom: '2026-10-01T00:00:00Z', quakeTo: '1791417600000' }, [
      quakes(),
    ]);
    expect(crossfilterSql([QUAKES], source)).toBe(
      `(TRUE AND "time" >= '2026-10-01T00:00:00.000Z' AND "time" <= '2026-10-08T00:00:00.000Z' AND "mag" < 6)`
    );
  });

  it('reads a date and time with no zone as UTC, wherever the viewer is', () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/Guayaquil';
    try {
      const source = sourceOf({ ...EMPTY, quakeFrom: '2026-10-01 05:00', quakeTo: '2026-10-02T00:00:00' }, [quakes()]);
      expect(crossfilterSql([QUAKES, '-mag'], source)).toBe(
        `(TRUE AND "time" >= '2026-10-01T05:00:00.000Z' AND "time" <= '2026-10-02T00:00:00.000Z')`
      );
    } finally {
      process.env.TZ = zone;
    }
  });

  it('prefixes columns with the alias', () => {
    const source = sourceOf({ ...EMPTY, mag_lo: '5' }, [quakes()]);
    expect(crossfilterSql([`${QUAKES} AS q`], source)).toBe('(TRUE AND "q"."mag" >= 5)');
  });

  it('takes only a filters variable, since Grafana re-runs a panel only for the variables it names', () => {
    const source = sourceOf(EMPTY, [quakes()]);
    expect(() => crossfilterSql(['quakes'], source)).toThrow('$__crossfilter takes a filters variable');
    expect(() => crossfilterSql(['"d1_quakes_v1"'], source)).toThrow('$__crossfilter takes a filters variable');
    expect(() => crossfilterSql(["'quakes'"], source)).toThrow('$__crossfilter takes a filters variable');
  });

  it('builds IN, equals and search from quoted values, and skips All', () => {
    const filters: FilterDeclaration[] = [
      { name: 'alert', type: 'in', column: 'alert', variable: 'alerts' },
      { name: 'country', type: 'equals', column: 'country', variable: 'country' },
      { name: 'place', type: 'search', column: 'place', variable: 'q' },
    ];
    const source = sourceOf({ alerts: ['red', "o'range"], country: 'Ecuador', q: 'Quito' }, [quakes(filters)]);
    expect(crossfilterSql([QUAKES], source)).toBe(
      `(TRUE AND "alert" IN ('red', 'o''range') AND "country" = 'Ecuador' AND contains(lower(CAST("place" AS VARCHAR)), 'quito'))`
    );
    const all = sourceOf({ alerts: ['$__all'], country: '', q: '' }, [quakes(filters)]);
    expect(crossfilterSql([QUAKES], all)).toBe('(TRUE)');
  });

  it('never lets a value out of its literal or its number', () => {
    const filters: FilterDeclaration[] = [
      { name: 'country', type: 'equals', column: 'country', variable: 'country' },
      { name: 'mag', type: 'range', column: 'mag', from: 'lo', to: 'hi' },
      { name: 'area', type: 'area', variable: 'area', lat: 'lat', lng: 'lng' },
    ];
    const source = sourceOf(
      { country: "x'; DROP TABLE t; --", lo: '1; DROP TABLE t', hi: '2 OR 1=1', area: "POLYGON((0 0, 1 0, ')); DROP" },
      [quakes(filters)]
    );
    expect(crossfilterSql([QUAKES], source)).toBe(`(TRUE AND "country" = 'x''; DROP TABLE t; --')`);
  });

  it('fails loudly on undeclared filters, an unknown filter name or a missing variable', () => {
    const source = sourceOf(EMPTY, [quakes()]);
    expect(() => crossfilterSql(["'ships#00c0ffee'"], source)).toThrow(
      'No filters are declared for a dataset ships on this dashboard'
    );
    expect(() => crossfilterSql([QUAKES, '-magnitude'], source)).toThrow(
      'Dataset quakes declares no filter magnitude; it has time, mag, depth, area, alert'
    );
    expect(() => crossfilterSql([QUAKES, 'mag'], source)).toThrow('leaves filters out as -name');
    expect(() => crossfilterSql([QUAKES], sourceOf({ mag_lo: '1' }, [quakes()]))).toThrow(
      'Filter time of dataset quakes reads the variable quakeFrom, which this dashboard does not have'
    );
  });

  it('filters by a cohort of another dataset, and refuses a loop of links', () => {
    const exposure: DeclaredDataset = {
      name: 'exposure',
      table: 'd1_exposure_v1',
      filters: [{ name: 'quakes', type: 'link', column: 'id', dataset: 'quakes', to: 'id' }],
    };
    const off = sourceOf(EMPTY, [quakes(), exposure]);
    expect(crossfilterSql([EXPOSURE], off)).toBe('(TRUE)');
    const on = sourceOf({ ...EMPTY, mag_lo: '6' }, [quakes(), exposure]);
    expect(crossfilterSql([EXPOSURE], on)).toBe(
      '(TRUE AND "id" IN (SELECT "id" FROM "d1_quakes_v1" WHERE "mag" >= 6))'
    );
    const back = quakes([{ name: 'exposure', type: 'link', column: 'id', dataset: 'exposure', to: 'id' }]);
    expect(() => crossfilterSql([EXPOSURE], sourceOf(EMPTY, [back, exposure]))).toThrow(
      'The link filters of dataset exposure lead back to it'
    );
  });
});

describe('filtersSql', () => {
  it('lists every declared filter with what the bar shows and the variables that clear it', () => {
    const source = sourceOf(
      { ...EMPTY, mag_lo: '4.5', quakeArea: 'POLYGON((0 0, 1 0, 1 1, 0 0))', alerts: ['a', 'b', 'c', 'd'] },
      [quakes()]
    );
    expect(filtersSql([QUAKES], source)).toBe(
      "(SELECT * FROM (VALUES ('time', 'time', FALSE, '', 'quakeFrom,quakeTo'), ('mag', 'Magnitude', TRUE, '≥ 4.5', 'mag_lo,mag_hi'), " +
        "('depth', 'depth', FALSE, '', 'depth_lo,depth_hi'), ('area', 'area', TRUE, 'drawn area', 'quakeArea'), " +
        "('alert', 'alert', TRUE, '4 values', 'alerts')) AS f(name, label, active, value, variables))"
    );
  });
});

describe('the SQL on DuckDB', () => {
  let runner: SqlRunner;

  beforeAll(async () => {
    runner = await createNodeRunner();
    // A grid of quakes: every 0.5 degree from -10 to 10, magnitude and depth cycling, a day apart. Built as
    // TIMESTAMP and cast: without ICU, DuckDB-WASM adds no interval to a TIMESTAMPTZ.
    await runner.exec(`CREATE TABLE d1_quakes_v1 AS
      SELECT i AS id,
             (TIMESTAMP '2026-09-01' + to_days(i % 30))::TIMESTAMPTZ AS time,
             CAST(TIMESTAMP '2026-09-01' + to_days(i % 30) AS TIMESTAMP_MS) AS time_ms,
             (i % 13) * 0.5 AS mag,
             greatest(least((i * 7) % 320, 299.9), 0) AS depth_axis,
             -10 + (i % 41) * 0.5 AS latitude,
             -10 + (i // 41) * 0.5 AS longitude,
             CASE i % 4 WHEN 0 THEN 'green' WHEN 1 THEN 'yellow' WHEN 2 THEN 'red' END AS alert
      FROM range(41 * 41) AS t(i)`);
  });

  const count = async (where: string): Promise<number> =>
    Number((await runner.query(`SELECT count(*) AS n FROM d1_quakes_v1 WHERE ${where}`)).get(0)?.n);

  // The earthquakes dashboard's hand-written query, as it is today: the drawn area parsed in SQL and
  // cross-joined, every range behind try_cast.
  const handWritten = async (v: Record<string, string>): Promise<number> => {
    const sql = `WITH area AS (
        SELECT list_transform(xs, lambda x: x - 360 * round(coalesce(list_avg(xs), 0) / 360)) AS xs, ys
        FROM (SELECT list_filter(n, lambda v, i: i % 2 = 1) AS xs, list_filter(n, lambda v, i: i % 2 = 0) AS ys
              FROM (SELECT CAST(regexp_extract_all('${v.quakeArea}', '-?[0-9]+(?:\\.[0-9]+)?(?:[eE][-+]?[0-9]+)?') AS DOUBLE[]) AS n)))
      SELECT count(*) AS n FROM d1_quakes_v1, area
      WHERE time >= coalesce(try_cast('${v.quakeFrom}' AS TIMESTAMPTZ), '-infinity'::TIMESTAMPTZ)
        AND time <= coalesce(try_cast('${v.quakeTo}' AS TIMESTAMPTZ), 'infinity'::TIMESTAMPTZ)
        AND mag >= coalesce(try_cast('${v.mag_lo}' AS DOUBLE), '-infinity'::DOUBLE)
        AND mag < coalesce(try_cast('${v.mag_hi}' AS DOUBLE), 'infinity'::DOUBLE)
        AND depth_axis >= coalesce(try_cast('${v.depth_lo}' AS DOUBLE), '-infinity'::DOUBLE)
        AND depth_axis < coalesce(try_cast('${v.depth_hi}' AS DOUBLE), 'infinity'::DOUBLE)
        AND (len(area.xs) = 0 OR list_sum(list_transform(range(1, len(area.xs) + 1), lambda i:
          CASE WHEN (area.ys[i] > latitude) <> (area.ys[i % len(area.xs) + 1] > latitude)
                AND longitude < (area.xs[i % len(area.xs) + 1] - area.xs[i]) * (latitude - area.ys[i]) / (area.ys[i % len(area.xs) + 1] - area.ys[i]) + area.xs[i]
               THEN 1 ELSE 0 END)) % 2 = 1)`;
    return Number((await runner.query(sql)).get(0)?.n);
  };

  const cases: Array<[string, Partial<typeof EMPTY>]> = [
    ['nothing', {}],
    ['a magnitude band', { mag_lo: '2', mag_hi: '4.5' }],
    ['a lower depth only', { depth_lo: '100' }],
    ['a time window', { quakeFrom: '2026-09-05T00:00:00Z', quakeTo: '2026-09-12T00:00:00Z' }],
    ['a triangle', { quakeArea: 'POLYGON((-5 -5, 6 -2, 0 7.3, -5 -5))' }],
    ['a concave area across zero', { quakeArea: 'POLYGON((-8 -8, 8 -8, 8 8, 0 0.25, -8 8, -8 -8))' }],
    [
      'everything',
      {
        mag_lo: '1',
        mag_hi: '5',
        depth_hi: '200',
        quakeFrom: '2026-09-03',
        quakeArea: 'POLYGON((-9 -9, 9 -9, 9 9, -9 9, -9 -9))',
      },
    ],
  ];

  it.each(cases)('counts the same rows as the hand-written clauses with %s', async (_, set) => {
    const values = { ...EMPTY, ...set };
    const filters = QUAKE_FILTERS.filter((f) => f.name !== 'alert');
    const generated = crossfilterSql([QUAKES], sourceOf(values, [quakes(filters)]));
    const expected = await handWritten(values as unknown as Record<string, string>);
    expect(await count(generated)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it('compares times with a TIMESTAMP_MS column, as server-fed datasets have', async () => {
    const filters: FilterDeclaration[] = [
      { name: 't', type: 'range', column: 'time_ms', as: 'time', from: 'a', to: 'b' },
    ];
    const source = sourceOf({ a: '2026-09-05T00:00:00Z', b: '2026-09-12T00:00:00Z' }, [quakes(filters)]);
    expect(await count(crossfilterSql([QUAKES], source))).toBe(
      await count(`time_ms >= '2026-09-05' AND time_ms < '2026-09-12'`)
    );
  });

  it('runs IN, the cohort link and the filter table', async () => {
    await runner.exec('CREATE TABLE d1_exposure_v1 AS SELECT id, id * 10 AS people FROM d1_quakes_v1');
    const exposure: DeclaredDataset = {
      name: 'exposure',
      table: 'd1_exposure_v1',
      filters: [{ name: 'quakes', type: 'link', column: 'id', dataset: 'quakes', to: 'id' }],
    };
    const source = sourceOf({ ...EMPTY, alerts: ['red'], mag_lo: '5' }, [quakes(), exposure]);
    const red = await count(crossfilterSql([QUAKES], source));
    expect(red).toBe(await count(`alert = 'red' AND mag >= 5`));
    const linked = await runner.query(
      `SELECT count(*) AS n FROM d1_exposure_v1 WHERE ${crossfilterSql([EXPOSURE], source)}`
    );
    expect(Number(linked.get(0)?.n)).toBe(red);
    const bar = await runner.query(`SELECT name, active FROM ${filtersSql([QUAKES], source)} WHERE active`);
    expect(bar.toArray().map((r) => r.name)).toEqual(['mag', 'alert']);
  });
});
