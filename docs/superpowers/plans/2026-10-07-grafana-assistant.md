# Grafana Assistant Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a Grafana with the Grafana Assistant, a Chaski dashboard registers a live description of its browser datasets (names, `$name`, rows, columns, freshness, time range) plus starter questions, and Chaski exports skill texts for pasting into the Assistant.

**Architecture:** Pure digest builder → page-context/questions registration (`@grafana/assistant`) → a live controller fed by the engine's public API events (`onChange`, `datasets()`), a `DESCRIBE` per new table, and the URL. Wired once in `getEngine`. Skills are exported strings with tests that hold them to the code. Mirrors `/home/jag/dev/kepler-grafana/src/assistant/`.

**Tech Stack:** TypeScript, React-free, `@grafana/assistant@0.1.34`, `@grafana/runtime` (`locationService`), `@grafana/data` (`dateMath`), apache-arrow 17, Jest.

**Spec:** `docs/superpowers/specs/2026-10-07-grafana-assistant-design.md`

## Global Constraints

- No `@grafana/*` import under `src/engine/` (ESLint enforces it). New code lives in `src/assistant/` and `src/grafana/`.
- Nothing registered unless `isAssistantAvailable()` emits `true`; no backend calls.
- Page context and questions are scoped to `/d/<uid>` of the active dashboard, never `/\/d\//`; the key `no-dashboard` registers nothing.
- DESCRIBE runs on the explorer path (`api.queryIPC`, default consumer) so it never counts toward `ubica-duckdbwasm-activity`.
- Do not modify `.config/`. `plugin.json` changes need a Grafana restart (tell the user).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verify with `npm run test:ci`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Review Focus

1. A burst of dataset loads (5 datasets adopting at once) must register once at the end, not five times — test in Task 4.
2. Leaving for a dashboard on another datasource fires no engine event; the context must not show there — covered by uid pattern test in Task 2.
3. A DESCRIBE that rejects (view dropped mid-navigation) must not break the digest — the dataset appears without `columns` (Task 4).
4. URL `from`/`to` as epoch-ms strings (`1696000000000`), relative (`now-6h`), or garbage — epoch and relative resolve to ISO, garbage omits `timeRange` (Task 5).
5. Assistant becomes available after datasets already loaded — the controller must build from current `datasets()` immediately, not wait for the next event (Task 4).

---

### Task 1: Dependency and digest

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/assistant/digest.ts`
- Test: `src/assistant/digest.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface DigestColumn { name: string; type: string }
  export interface DigestDataset { name: string; panelSql: string; view: string; rows: number; loadedAt: string; stale?: string; columns?: DigestColumn[] }
  export interface AssistantDigest { dashboard: string; datasets: DigestDataset[]; timeRange?: { from: string; to: string } }
  export interface DigestInput { dashboard: string; datasets: DatasetInfo[]; columns: ReadonlyMap<string, DigestColumn[]>; timeRange?: { from: string; to: string } }
  export function buildAssistantDigest(input: DigestInput): AssistantDigest
  ```
  `columns` is keyed by `DatasetInfo.table`. `DatasetInfo` is from `src/grafana/publicApi.ts`.

- [ ] **Step 1: Install the SDK**

Run: `npm install --save-exact @grafana/assistant@0.1.34`
Expected: added to `dependencies` as `"@grafana/assistant": "0.1.34"`; no peer warnings (our `@grafana/*` are 13.1.0, peers want `>=12.1.0`), so no `overrides` entry is needed.

- [ ] **Step 2: Write the failing test** — `src/assistant/digest.test.ts`

```ts
import { buildAssistantDigest } from './digest';

const base = { name: 'vehicles', view: 'datasets."vehicles"', table: 't_vehicles_3', rows: 120, loadedAt: Date.UTC(2026, 9, 7, 12) };

describe('buildAssistantDigest', () => {
  it('describes each dataset the way panel SQL and the explorer read it', () => {
    const digest = buildAssistantDigest({
      dashboard: 'abc',
      datasets: [base],
      columns: new Map([['t_vehicles_3', [{ name: 'route', type: 'VARCHAR' }]]]),
      timeRange: { from: '2026-10-07T06:00:00.000Z', to: '2026-10-07T12:00:00.000Z' },
    });
    expect(digest).toEqual({
      dashboard: 'abc',
      datasets: [
        {
          name: 'vehicles',
          panelSql: '$vehicles',
          view: 'datasets."vehicles"',
          rows: 120,
          loadedAt: '2026-10-07T12:00:00.000Z',
          columns: [{ name: 'route', type: 'VARCHAR' }],
        },
      ],
      timeRange: { from: '2026-10-07T06:00:00.000Z', to: '2026-10-07T12:00:00.000Z' },
    });
  });

  it('says when the data is stale and leaves out columns it could not describe', () => {
    const digest = buildAssistantDigest({ dashboard: 'abc', datasets: [{ ...base, stale: 'HTTP 503' }], columns: new Map() });
    expect(digest.datasets[0].stale).toBe('HTTP 503');
    expect(digest.datasets[0]).not.toHaveProperty('columns');
    expect(digest).not.toHaveProperty('timeRange');
  });
});
```

- [ ] **Step 3: Run it** — `npx jest src/assistant/digest.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement** — `src/assistant/digest.ts`

```ts
import type { DatasetInfo } from '../grafana/publicApi';

export interface DigestColumn {
  name: string;
  type: string;
}

export interface DigestDataset {
  name: string;
  /** How panel SQL reads it: `$vehicles`. */
  panelSql: string;
  /** How the engine API and explorer read it: `datasets."vehicles"`. */
  view: string;
  rows: number;
  loadedAt: string;
  /** The latest reload's error; the previous data is still served. */
  stale?: string;
  /** DuckDB column types; absent when DESCRIBE failed. */
  columns?: DigestColumn[];
}

export interface AssistantDigest {
  dashboard: string;
  datasets: DigestDataset[];
  timeRange?: { from: string; to: string };
}

export interface DigestInput {
  dashboard: string;
  datasets: DatasetInfo[];
  /** Columns per physical table, so an unchanged version is described once. */
  columns: ReadonlyMap<string, DigestColumn[]>;
  timeRange?: { from: string; to: string };
}

/** What the Assistant is told about the datasets on screen: enough to write panel SQL over them. */
export function buildAssistantDigest(input: DigestInput): AssistantDigest {
  return {
    dashboard: input.dashboard,
    datasets: input.datasets.map((d) => {
      const columns = input.columns.get(d.table);
      return {
        name: d.name,
        panelSql: `$${d.name}`,
        view: d.view,
        rows: d.rows,
        loadedAt: new Date(d.loadedAt).toISOString(),
        ...(d.stale ? { stale: d.stale } : {}),
        ...(columns ? { columns } : {}),
      };
    }),
    ...(input.timeRange ? { timeRange: input.timeRange } : {}),
  };
}
```

- [ ] **Step 5: Run it** — `npx jest src/assistant/digest.test.ts` → PASS. Also `npm run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/assistant/digest.ts src/assistant/digest.test.ts
git commit -m "feat: a digest of the dashboard's datasets for the Grafana Assistant"
```

---

### Task 2: Page context and questions

**Files:**
- Create: `src/assistant/pageContext.ts`
- Test: `src/assistant/pageContext.test.ts`

**Interfaces:**
- Consumes: `AssistantDigest` (Task 1).
- Produces:
  ```ts
  export function dashboardPattern(uid: string): RegExp
  export function buildContextItems(digest: AssistantDigest): ChatContextItem[]
  export function assistantQuestions(): Question[]
  /** Registers context + questions for digest.dashboard; returns the unregister fn. */
  export function registerAssistant(digest: AssistantDigest): () => void
  ```

- [ ] **Step 1: Write the failing test** — `src/assistant/pageContext.test.ts`

```ts
import { providePageContext, provideQuestions } from '@grafana/assistant';

import { assistantQuestions, buildContextItems, dashboardPattern, registerAssistant } from './pageContext';

jest.mock('@grafana/assistant', () => ({
  createAssistantContextItem: (type: string, params: object) => ({ type, ...params }),
  providePageContext: jest.fn(),
  provideQuestions: jest.fn(),
}));

const digest = { dashboard: 'abc-1', datasets: [] };

describe('dashboardPattern', () => {
  it('matches only that dashboard', () => {
    const p = dashboardPattern('abc-1');
    expect(p.test('/d/abc-1/sales')).toBe(true);
    expect(p.test('/d/abc-1')).toBe(true);
    expect(p.test('/d/abc-1?orgId=1')).toBe(true);
    expect(p.test('/d/abc-12/other')).toBe(false);
    expect(p.test('/d/xyz/other')).toBe(false);
  });

  it('escapes the uid', () => {
    expect(dashboardPattern('a.b').test('/d/aXb/x')).toBe(false);
  });
});

describe('registerAssistant', () => {
  it('registers the digest and the questions on the dashboard, and unregisters both', () => {
    const ctx = jest.fn();
    const q = jest.fn();
    (providePageContext as jest.Mock).mockReturnValue(Object.assign(jest.fn(), { unregister: ctx }));
    (provideQuestions as jest.Mock).mockReturnValue(Object.assign(jest.fn(), { unregister: q }));

    const unregister = registerAssistant(digest);

    const [pattern, items] = (providePageContext as jest.Mock).mock.calls[0];
    expect(pattern.test('/d/abc-1/x')).toBe(true);
    expect(items).toEqual(buildContextItems(digest));
    expect((provideQuestions as jest.Mock).mock.calls[0][1]).toEqual(assistantQuestions());
    unregister();
    expect(ctx).toHaveBeenCalled();
    expect(q).toHaveBeenCalled();
  });
});

it('titles the item and carries the digest as data', () => {
  expect(buildContextItems(digest)).toEqual([
    { type: 'structured', title: 'Chaski datasets (live)', bypassLimits: false, data: digest },
  ]);
});
```

- [ ] **Step 2: Run it** — `npx jest src/assistant/pageContext.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/assistant/pageContext.ts`

```ts
import {
  createAssistantContextItem,
  providePageContext,
  provideQuestions,
  type ChatContextItem,
  type Question,
} from '@grafana/assistant';

import type { AssistantDigest } from './digest';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `/d/<uid>` and nothing else. Not `/\/d\//`: leaving for a dashboard on
 * another datasource fires no engine event, and the datasets must not follow
 * the user there.
 */
export function dashboardPattern(uid: string): RegExp {
  return new RegExp(`/d/${escape(uid)}(?:[/?#]|$)`);
}

export function buildContextItems(digest: AssistantDigest): ChatContextItem[] {
  return [
    createAssistantContextItem('structured', {
      title: 'Chaski datasets (live)',
      bypassLimits: false,
      data: digest as unknown as Record<string, unknown>,
    }),
  ];
}

export function assistantQuestions(): Question[] {
  return [
    { title: 'What data is loaded?', prompt: 'What data does this dashboard load into Chaski, and how fresh is it?' },
    {
      title: 'Write a panel query',
      prompt: 'Write a Chaski panel query over one of the datasets on this dashboard, using its real columns.',
    },
  ];
}

/** Registers the digest and the starter questions for its dashboard; returns the unregister fn. */
export function registerAssistant(digest: AssistantDigest): () => void {
  const pattern = dashboardPattern(digest.dashboard);
  const context = providePageContext(pattern, buildContextItems(digest));
  const questions = provideQuestions(pattern, assistantQuestions());
  return () => {
    context.unregister();
    questions.unregister();
  };
}
```

- [ ] **Step 4: Run it** → PASS. Check `provideQuestions`'s return type in `node_modules/@grafana/assistant/dist/context/` has `.unregister` (it does in 0.1.34, as kepler uses it); `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/assistant/pageContext.ts src/assistant/pageContext.test.ts
git commit -m "feat: register the datasets digest and starter questions on the dashboard's own URL"
```

---

### Task 3: Skills

**Files:**
- Create: `src/assistant/skills.ts`
- Test: `src/assistant/skills.test.ts`

**Interfaces:**
- Produces: `export const chaskiAssistantSkill: string`, `export const exampleDatasetVariable`, `export const examplePanelTarget`, `export const dashboardAuthoringSkill: string`.

- [ ] **Step 1: Write the failing test** — `src/assistant/skills.test.ts`

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

import { expandMacros } from '../engine/macros';
import { chaskiAssistantSkill, dashboardAuthoringSkill, exampleDatasetVariable, examplePanelTarget } from './skills';

/** A call of each macro Chaski expands; the skills may name only these. */
const calls: Record<string, string> = {
  timeFilter: '$__timeFilter(t)',
  timeFrom: '$__timeFrom()',
  timeTo: '$__timeTo()',
  timeGroup: '$__timeGroup(t, 1h)',
  proxy: "$__proxy('a.parquet')",
};
const ctx = { from: 0, to: 3600_000, proxyBase: 'http://g/api/datasources/proxy/uid/x/_plain' };

describe.each([
  ['chaskiAssistantSkill', chaskiAssistantSkill],
  ['dashboardAuthoringSkill', dashboardAuthoringSkill],
])('%s', (_, skill) => {
  it('names only macros Chaski expands', () => {
    const named = new Set([...skill.matchAll(/\$__(\w+)/g)].map((m) => m[1]));
    for (const name of named) {
      expect(Object.keys(calls)).toContain(name);
      expect(expandMacros(calls[name], ctx)).not.toBe(calls[name]);
    }
  });
});

describe('chaskiAssistantSkill', () => {
  it('names every macro and the no-execution limit', () => {
    for (const name of Object.keys(calls)) {
      expect(chaskiAssistantSkill).toContain(`$__${name}`);
    }
    expect(chaskiAssistantSkill).toMatch(/cannot run/i);
  });
});

describe('the authoring example', () => {
  const provisioned = JSON.parse(readFileSync(join(__dirname, '../../provisioning/dashboards/e2e.json'), 'utf8'));
  const dataset = provisioned.templating.list.find((v: { query?: { kind?: string } }) => v.query?.kind === 'dataset');

  it('has the shape of a provisioned dataset variable', () => {
    expect(Object.keys(exampleDatasetVariable).sort()).toEqual(
      expect.arrayContaining(['datasource', 'hide', 'name', 'query', 'refresh', 'skipUrlSync', 'type'])
    );
    expect(Object.keys(exampleDatasetVariable.query).sort()).toEqual(Object.keys(dataset.query).sort());
    expect(exampleDatasetVariable.datasource.type).toBe(dataset.datasource.type);
    expect(exampleDatasetVariable.query.name).toBe(exampleDatasetVariable.name);
    expect(exampleDatasetVariable.hide).toBe(2);
  });

  it('reads the dataset by its $name in panel SQL', () => {
    expect(examplePanelTarget.rawSql).toContain(`$${exampleDatasetVariable.name}`);
    expect(dashboardAuthoringSkill).toContain(JSON.stringify(exampleDatasetVariable));
  });
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** — `src/assistant/skills.ts`

```ts
import type { DatasetVariableQuery, DuckQuery } from '../types';

/**
 * What an assistant needs to write SQL for Chaski panels. Exported for
 * pasting into the Assistant's instructions (docs/grafana-assistant.md quotes
 * it); skills.test.ts holds its macros to src/engine/macros.ts.
 */
export const chaskiAssistantSkill = `# Chaski (DuckDB in the browser)
Chaski loads a dashboard's datasets once into DuckDB running in the viewer's browser and answers
every panel query there. You cannot run Chaski queries: they never reach the server. Write the SQL
for the panel and let the dashboard run it. The live context "Chaski datasets (live)" lists the
datasets on screen with their columns and DuckDB types; use those names.
A dataset is a hidden query variable of this datasource (kind 'dataset'). Panel SQL reads it as
$name, e.g. SELECT route, count(*) FROM $vehicles GROUP BY 1. Other dashboard variables are quoted
like the server DuckDB datasource: $x → 'value', multi-value → 'a','b', \${x:raw} verbatim.
Macros: $__timeFilter(col), $__timeFrom(), $__timeTo(), $__timeGroup(col, 1h) (a time_bucket),
$__proxy('path') (a file read through Grafana's data proxy with the datasource's credentials).
A dataset that reloads on time-range change keeps its table when the new range fits inside the
loaded one, so its source must return plain rows for the range (no ORDER BY … LIMIT, no totals),
and panels reading it must filter by time themselves with $__timeFilter.
Geometry columns reach panels as WKB hex; for a map with many rows select ST_AsGeoJSON(geom).`;

/** A dataset variable as a dashboard's templating list holds it. Held to the provisioned dashboards by a test. */
export const exampleDatasetVariable = {
  name: 'vehicles',
  type: 'query',
  hide: 2,
  skipUrlSync: true,
  refresh: 2,
  datasource: { type: 'ubica-chaski-datasource', uid: '<chaski uid>' },
  query: {
    refId: 'vehicles',
    kind: 'dataset',
    name: 'vehicles',
    source: {
      type: 'sql',
      sql: "SELECT * FROM read_parquet('https://example.org/vehicles.parquet') WHERE $__timeFilter(t)",
    },
  } satisfies DatasetVariableQuery,
};

export const examplePanelTarget = {
  refId: 'A',
  datasource: { type: 'ubica-chaski-datasource', uid: '<chaski uid>' },
  rawSql: 'SELECT $__timeGroup(t, 1h) AS time, count(*) AS n FROM $vehicles WHERE $__timeFilter(t) GROUP BY 1 ORDER BY 1',
} satisfies DuckQuery & { datasource: unknown };

/** What an assistant building a whole dashboard on Chaski gets wrong without being told. */
export const dashboardAuthoringSkill = `# Authoring dashboards on Chaski
Each dataset is a dashboard variable in templating.list: type 'query', hide 2, skipUrlSync true,
datasource Chaski, and a query object with kind 'dataset', the dataset's name (same as the
variable's) and a source: {"type":"sql","sql":…} to read a URL that allows CORS or derive from
another dataset, or {"type":"datasource","datasource":{type,uid},"query":{…}} to load from another
Grafana datasource. refresh 1 loads on dashboard load; refresh 2 also on time-range change.
Example variable:
${JSON.stringify(exampleDatasetVariable)}
A panel target on Chaski has only refId, datasource and rawSql:
${JSON.stringify(examplePanelTarget)}
Put datasets before the variables and panels that read them. Values variables (dropdowns) use
kind 'values' with sql whose first column is the value.`;
```

- [ ] **Step 4: Run it** → PASS. If the `satisfies` on `examplePanelTarget` fails typecheck, drop it to `satisfies Pick<DuckQuery, 'refId' | 'rawSql'> & { datasource: { type: string; uid: string } }`. Run `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/assistant/skills.ts src/assistant/skills.test.ts
git commit -m "feat: export Assistant skills for Chaski panel SQL and dashboard authoring"
```

---

### Task 4: Live controller

**Files:**
- Create: `src/assistant/liveContext.ts`
- Test: `src/assistant/liveContext.test.ts`

**Interfaces:**
- Consumes: `buildAssistantDigest`, `DigestColumn` (Task 1); `registerAssistant` (Task 2); `DatasetInfo`, `ChangeEvent` from `src/grafana/publicApi.ts`.
- Produces:
  ```ts
  export interface LiveContextDeps {
    datasets(): DatasetInfo[];
    onChange(listener: (event: ChangeEvent) => void): () => void;
    describe(view: string): Promise<DigestColumn[]>;
    activeDashboard(): string | undefined;
    timeRange(): { from: string; to: string } | undefined;
    onLocation(listener: () => void): () => void;
    available: Observable<boolean>;
    register?: (digest: AssistantDigest) => () => void; // default registerAssistant
  }
  /** Returns a stop fn. Never throws. */
  export function startAssistantContext(deps: LiveContextDeps): () => void
  /** Resolves once queued rebuilds are done (tests). */
  export function settled(): Promise<void>  // returned as `stop.settled`
  ```
  Concretely `startAssistantContext` returns `Object.assign(stop, { settled: () => Promise<void> })`.

- [ ] **Step 1: Write the failing test** — `src/assistant/liveContext.test.ts`

```ts
import { BehaviorSubject } from 'rxjs';

import type { ChangeEvent, DatasetInfo } from '../grafana/publicApi';
import type { AssistantDigest } from './digest';
import { startAssistantContext, type LiveContextDeps } from './liveContext';

jest.mock('./pageContext', () => ({ registerAssistant: jest.fn() }));

function setup(initial: DatasetInfo[] = [], dashboard: string | undefined = 'abc') {
  let datasets = initial;
  let changeListener: (e: ChangeEvent) => void = () => undefined;
  let locationListener: () => void = () => undefined;
  const available = new BehaviorSubject(true);
  const registered: AssistantDigest[] = [];
  const unregister = jest.fn();
  const describe = jest.fn(async (view: string) => [{ name: `${view}_col`, type: 'INTEGER' }]);
  const deps: LiveContextDeps = {
    datasets: () => datasets,
    onChange: (l) => ((changeListener = l), () => undefined),
    describe,
    activeDashboard: () => dashboard,
    timeRange: () => undefined,
    onLocation: (l) => ((locationListener = l), () => undefined),
    available,
    register: (digest) => (registered.push(digest), unregister),
  };
  const stop = startAssistantContext(deps);
  return {
    stop,
    available,
    registered,
    unregister,
    describe,
    setDatasets: (d: DatasetInfo[]) => (datasets = d),
    setDashboard: (d: string) => (dashboard = d),
    change: (e: ChangeEvent) => changeListener(e),
    navigate: () => locationListener(),
  };
}

const ds = (name: string, table = `t_${name}_1`): DatasetInfo => ({ name, view: `datasets."${name}"`, table, rows: 1, loadedAt: 0 });

it('registers what is already loaded as soon as the Assistant is there', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
  expect(t.registered[0].datasets[0].columns).toEqual([{ name: 'datasets."a"_col', type: 'INTEGER' }]);
});

it('registers nothing while the Assistant is unavailable, and unregisters when it goes', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.available.next(false);
  expect(t.unregister).toHaveBeenCalledTimes(1);
  t.change({ kind: 'dataset', name: 'a', view: 'datasets."a"' });
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
});

it('registers nothing with no datasets or outside a dashboard', async () => {
  const t = setup([], 'abc');
  await t.stop.settled();
  expect(t.registered).toHaveLength(0);
  const u = setup([ds('a')], 'no-dashboard');
  await u.stop.settled();
  expect(u.registered).toHaveLength(0);
});

it('coalesces a burst of loads into one registration', async () => {
  const t = setup([]);
  await t.stop.settled();
  const names = ['a', 'b', 'c', 'd', 'e'];
  t.setDatasets(names.map((n) => ds(n)));
  for (const name of names) {
    t.change({ kind: 'dataset', name, view: `datasets."${name}"` });
  }
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
  expect(t.registered[0].datasets).toHaveLength(5);
});

it('describes a table once, and again only when a new version lands', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.navigate();
  await t.stop.settled();
  expect(t.describe).toHaveBeenCalledTimes(1);
  t.setDatasets([ds('a', 't_a_2')]);
  t.change({ kind: 'dataset', name: 'a', view: 'datasets."a"' });
  await t.stop.settled();
  expect(t.describe).toHaveBeenCalledTimes(2);
});

it('does not re-register an unchanged digest', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.navigate();
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
  expect(t.unregister).not.toHaveBeenCalled();
});

it('keeps a dataset whose DESCRIBE fails, without columns', async () => {
  const t = setup([ds('a')]);
  t.describe.mockRejectedValueOnce(new Error('gone'));
  await t.stop.settled();
  expect(t.registered[0].datasets[0]).not.toHaveProperty('columns');
});

it('moves the registration to the next dashboard', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.setDashboard('xyz');
  t.setDatasets([ds('b')]);
  t.change({ kind: 'dashboard', dashboard: 'xyz' });
  await t.stop.settled();
  expect(t.unregister).toHaveBeenCalledTimes(1);
  expect(t.registered[1].dashboard).toBe('xyz');
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** — `src/assistant/liveContext.ts`

```ts
import type { Observable } from 'rxjs';

import type { ChangeEvent, DatasetInfo } from '../grafana/publicApi';
import { buildAssistantDigest, type AssistantDigest, type DigestColumn } from './digest';
import { registerAssistant } from './pageContext';

export interface LiveContextDeps {
  datasets(): DatasetInfo[];
  onChange(listener: (event: ChangeEvent) => void): () => void;
  describe(view: string): Promise<DigestColumn[]>;
  activeDashboard(): string | undefined;
  timeRange(): { from: string; to: string } | undefined;
  onLocation(listener: () => void): () => void;
  available: Observable<boolean>;
  register?: (digest: AssistantDigest) => () => void;
}

/**
 * Keeps the Assistant's page context in step with the datasets on screen.
 * Rebuilds run one at a time and coalesce: a burst of events during a rebuild
 * yields one more rebuild, not one per event. Each table is described once.
 * Nothing here throws to the engine: a failure leaves the last registration.
 */
export function startAssistantContext(deps: LiveContextDeps) {
  const register = deps.register ?? registerAssistant;
  const columns = new Map<string, DigestColumn[]>();
  let enabled = false;
  let current: { key: string; unregister: () => void } | undefined;
  let dirty = false;
  let running: Promise<void> = Promise.resolve();
  let looping = false;

  const clear = () => {
    current?.unregister();
    current = undefined;
  };

  const rebuild = async () => {
    const dashboard = deps.activeDashboard();
    const list = dashboard && dashboard !== 'no-dashboard' ? deps.datasets() : [];
    for (const d of list) {
      if (!columns.has(d.table)) {
        const described = await deps.describe(d.view).catch(() => undefined);
        if (described) {
          columns.set(d.table, described);
        }
      }
    }
    const live = new Set(list.map((d) => d.table));
    for (const table of [...columns.keys()]) {
      if (!live.has(table)) {
        columns.delete(table);
      }
    }
    if (!enabled) {
      return;
    }
    if (!dashboard || list.length === 0) {
      clear();
      return;
    }
    const digest = buildAssistantDigest({ dashboard, datasets: list, columns, timeRange: deps.timeRange() });
    const key = JSON.stringify(digest);
    if (current?.key === key) {
      return;
    }
    clear();
    current = { key, unregister: register(digest) };
  };

  const refresh = () => {
    dirty = true;
    if (looping) {
      return;
    }
    looping = true;
    running = (async () => {
      while (dirty) {
        dirty = false;
        try {
          await rebuild();
        } catch (error) {
          console.warn('Chaski: Assistant context', error);
        }
      }
    })().finally(() => {
      looping = false;
    });
  };

  const offChange = deps.onChange(() => enabled && refresh());
  const offLocation = deps.onLocation(() => enabled && refresh());
  const subscription = deps.available.subscribe({
    next: (ok) => {
      enabled = ok;
      if (ok) {
        refresh();
      } else {
        clear();
      }
    },
    error: () => undefined,
  });

  const stop = () => {
    enabled = false;
    subscription.unsubscribe();
    offChange();
    offLocation();
    clear();
  };
  return Object.assign(stop, { settled: () => running });
}
```

Note: `settled()` returns the promise of the loop in flight; tests await it after triggering. Because `refresh` is synchronous and `running` is reassigned only when a new loop starts, an event during a loop is picked up by the same `while`.

- [ ] **Step 4: Run it** → PASS; `npm run typecheck && npm run lint`.

- [ ] **Step 5: Commit**

```bash
git add src/assistant/liveContext.ts src/assistant/liveContext.test.ts
git commit -m "feat: keep the Assistant's page context in step with the datasets on screen"
```

---

### Task 5: Wire into the engine

**Files:**
- Create: `src/grafana/assistant.ts`
- Test: `src/grafana/assistant.test.ts`
- Modify: `src/grafana/engine.ts` (inside the `.then` of `getEngine`, after `createEngineApi`)

**Interfaces:**
- Consumes: `startAssistantContext`, `LiveContextDeps` (Task 4); `ChaskiEngineApi` (`publicApi.ts`); `DatasetRegistry.activeDashboard()`.
- Produces:
  ```ts
  export function urlTimeRange(search: { from?: unknown; to?: unknown }): { from: string; to: string } | undefined
  export function columnsOf(ipc: Uint8Array): DigestColumn[]
  export function startAssistantForEngine(api: ChaskiEngineApi, registry: { activeDashboard(): string | undefined }): () => void
  ```

- [ ] **Step 1: Write the failing test** — `src/grafana/assistant.test.ts`

```ts
import { tableFromArrays, tableToIPC } from 'apache-arrow';

import { columnsOf, urlTimeRange } from './assistant';

jest.mock('@grafana/runtime', () => ({ locationService: {} }));
jest.mock('@grafana/assistant', () => ({ isAssistantAvailable: jest.fn() }));

describe('urlTimeRange', () => {
  it('reads epoch milliseconds', () => {
    expect(urlTimeRange({ from: '1696000000000', to: '1696003600000' })).toEqual({
      from: '2023-09-29T15:06:40.000Z',
      to: '2023-09-29T16:06:40.000Z',
    });
  });

  it('resolves relative ranges', () => {
    const r = urlTimeRange({ from: 'now-6h', to: 'now' })!;
    expect(Date.parse(r.to) - Date.parse(r.from)).toBeCloseTo(6 * 3600_000, -4);
  });

  it('omits what it cannot read', () => {
    expect(urlTimeRange({})).toBeUndefined();
    expect(urlTimeRange({ from: 'garbage', to: 'now' })).toBeUndefined();
  });
});

it('reads DESCRIBE rows', () => {
  const ipc = tableToIPC(tableFromArrays({ column_name: ['route', 't'], column_type: ['VARCHAR', 'TIMESTAMP'], null: ['YES', 'YES'] }));
  expect(columnsOf(ipc)).toEqual([
    { name: 'route', type: 'VARCHAR' },
    { name: 't', type: 'TIMESTAMP' },
  ]);
});
```

- [ ] **Step 2: Run it** → FAIL.

- [ ] **Step 3: Implement** — `src/grafana/assistant.ts`

```ts
import { isAssistantAvailable } from '@grafana/assistant';
import { dateMath } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { tableFromIPC } from 'apache-arrow';

import type { DigestColumn } from '../assistant/digest';
import { startAssistantContext } from '../assistant/liveContext';
import type { ChaskiEngineApi } from './publicApi';

const instant = (value: unknown, roundUp: boolean): string | undefined => {
  if (typeof value !== 'string' || value === '') {
    return undefined;
  }
  const parsed = /^\d+$/.test(value) ? dateMath.toDateTime(Number(value), {}) : dateMath.parse(value, roundUp);
  return parsed?.isValid() ? parsed.toISOString() : undefined;
};

/** The dashboard's range from the URL as ISO instants; undefined when either end is missing or unreadable. */
export function urlTimeRange(search: { from?: unknown; to?: unknown }): { from: string; to: string } | undefined {
  const from = instant(search.from, false);
  const to = instant(search.to, true);
  return from && to ? { from, to } : undefined;
}

export function columnsOf(ipc: Uint8Array): DigestColumn[] {
  return tableFromIPC(ipc)
    .toArray()
    .map((row) => ({ name: String(row.column_name), type: String(row.column_type) }));
}

/** Feeds the Assistant from the engine API other plugins use; DESCRIBE runs on explorer connections. */
export function startAssistantForEngine(
  api: ChaskiEngineApi,
  registry: { activeDashboard(): string | undefined }
): () => void {
  return startAssistantContext({
    datasets: () => api.datasets(),
    onChange: (listener) => api.onChange(listener),
    describe: async (view) => columnsOf(await api.queryIPC(`DESCRIBE ${view}`)),
    activeDashboard: () => registry.activeDashboard(),
    timeRange: () => urlTimeRange(locationService.getSearchObject()),
    onLocation: (listener) => locationService.getHistory().listen(() => listener()),
    available: isAssistantAvailable(),
  });
}
```

If `dateMath.toDateTime` is not exported in `@grafana/data` 13.1.0, use `dateTime(Number(value))` from `@grafana/data` instead (check `node_modules/@grafana/data/dist/types/datetime/`).

- [ ] **Step 4: Run it** → PASS.

- [ ] **Step 5: Wire it** — `src/grafana/engine.ts`, right after the `api = createEngineApi({...});` statement:

```ts
        // The Grafana Assistant hears about the datasets through the same API other plugins use.
        startAssistantForEngine(api, engine.registry);
```

and import `import { startAssistantForEngine } from './assistant';`. In `src/grafana/engine.test.ts` add to its mocks so existing tests stay hermetic:

```ts
jest.mock('./assistant', () => ({ startAssistantForEngine: jest.fn() }));
```

Also add the same `jest.mock('./grafana/assistant', …)` line to `src/datasource.test.ts` only if it fails because `@grafana/assistant` cannot load under Jest; otherwise leave it.

- [ ] **Step 6: Verify** — `npm run test:ci && npm run typecheck && npm run lint && npm run build`. All pass.

- [ ] **Step 7: Commit**

```bash
git add src/grafana/assistant.ts src/grafana/assistant.test.ts src/grafana/engine.ts src/grafana/engine.test.ts
git commit -m "feat: the engine tells the Grafana Assistant about the datasets on screen"
```

---

### Task 6: Docs

**Files:**
- Create: `docs/grafana-assistant.md`
- Modify: `README.md` (a "Grafana Assistant" section after "API for other plugins"; a row for `src/assistant/` in Layout), `src/README.md` (short section before "Limits"), `CHANGELOG.md` (new `## Unreleased` above 1.0.0), `src/plugin.json` (add `"grafana assistant"` to `keywords`).

- [ ] **Step 1: Write `docs/grafana-assistant.md`** covering, in this order: when it applies (Grafana with the Assistant; nothing on OSS); what the Assistant sees (per dataset: name, `$name`, view, rows, loaded at, stale error, columns with DuckDB types; the time range from the URL; scoped to the dashboard, re-registered on loads and range changes, nothing sent to a backend; DESCRIBE once per loaded version, not counted as activity); the limit (the Assistant cannot run Chaski queries — it writes SQL for panels); "Teaching it Chaski": paste `chaskiAssistantSkill` (quote it verbatim from `src/assistant/skills.ts`); "Authoring whole dashboards": paste `dashboardAuthoringSkill` (quote verbatim); note that the exports are the source of truth and tests hold them to the code.

- [ ] **Step 2: README / src/README / plugin.json / CHANGELOG** — README section (4–6 lines) linking `docs/grafana-assistant.md`; `src/README.md` section (3–4 lines, absolute GitHub link `https://github.com/ubica-ecuador/chaski/blob/main/docs/grafana-assistant.md`); CHANGELOG:

```markdown
## Unreleased

- **Grafana Assistant.** On a Grafana with the Assistant, a Chaski dashboard tells it which datasets
  are loaded in the browser: their `$name`, rows, freshness, columns with DuckDB types, and the time
  range, plus two starter questions. Nothing is registered without the Assistant. Two skill texts,
  `chaskiAssistantSkill` and `dashboardAuthoringSkill`, teach it Chaski's SQL and dataset variables;
  see docs/grafana-assistant.md.
```

- [ ] **Step 3: Verify** — `npx prettier --check README.md src/README.md docs/grafana-assistant.md CHANGELOG.md src/plugin.json` (fix with `--write`), `npm run lint`, `npm run build`. Grep the page: every `$__` in the doc's quoted skills matches the export.

- [ ] **Step 4: Commit**

```bash
git add docs/grafana-assistant.md README.md src/README.md CHANGELOG.md src/plugin.json
git commit -m "docs: the Grafana Assistant support, its skills and the changelog"
```

Remind the user: `plugin.json` changed, so restart Grafana.
