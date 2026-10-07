# Grafana Assistant support — design

Date: 2026-10-07. Mirrors the support added to kepler-grafana (free panel) on 2026-09-29/10-01,
adapted to a datasource plugin.

## Goal

On a Grafana with the Grafana Assistant, a dashboard served by Chaski hands the Assistant a live,
truthful description of the datasets loaded in the browser (names, how to reference them, rows,
columns and types, freshness, time range), plus a few starter questions. Chaski also ships skill
texts that teach an assistant how to write panel SQL and dataset variables correctly. On a Grafana
without the Assistant nothing changes and nothing is registered.

Success: with the Assistant open on a Chaski dashboard, asking "write a panel query over the
vehicles dataset" yields SQL that uses `$vehicles`, real column names and Chaski's macros, without
the user describing the data.

## Constraints

- `addFunction` (the `grafana-assistant-app/extension/v1` skill manifest Plus uses) exists only on
  `AppPlugin`. A `DataSourcePlugin` cannot register skills, so skills are exported texts plus a docs
  page to paste them from, exactly like the free kepler panel.
- Chaski is frontend-only: the Assistant cannot run Chaski queries (no `/api/ds/query` path). The
  skill must say so, so the Assistant writes SQL for panels instead of trying to execute it.
- `src/engine/` stays free of `@grafana/*` imports; all Assistant code lives in `src/assistant/`
  and is wired from `src/grafana/`.
- No backend calls; registration happens only when `isAssistantAvailable()` emits `true`.
- Do not touch `.config/`; `plugin.json` changes need a Grafana restart.

## Components

### Dependency

`@grafana/assistant@0.1.34`, with an `overrides` entry pinning its `@grafana/data`, `/runtime`,
`/ui` peers to ours and `@grafana/schema` to our version (as kepler-grafana does).

### `src/assistant/digest.ts` (pure)

`buildAssistantDigest({ datasets, columns, timeRange })` → `AssistantDigest`:

```ts
interface AssistantDigest {
  datasets: Array<{
    name: string;
    panelSql: string;      // "$vehicles"
    view: string;          // 'datasets."vehicles"' (engine API / explorer name)
    rows: number;
    loadedAt: string;      // ISO
    stale?: string;        // last reload error, previous data still served
    columns?: Array<{ name: string; type: string }>; // DuckDB types; absent if DESCRIBE failed
  }>;
  timeRange?: { from: string; to: string };
}
```

### `src/assistant/pageContext.ts`

- `buildContextItems(digest)` → one `structured` item titled `Chaski datasets (live)`.
- `registerAssistantContext(digest, dashboardUid)` → `providePageContext(<pattern for /d/<uid>>, …)`,
  returns unregister. Scoped to the dashboard's uid, not `/\/d\//`: leaving for a dashboard on
  another datasource fires no engine event, and the context must not follow the user there.
  The `no-dashboard` key (Explore, an unsaved dashboard) registers nothing.
- `assistantQuestions()` → two or three starters ("What data does this dashboard load?",
  "Write a panel query over one of these datasets"). One owner per page, see liveContext.

### `src/assistant/liveContext.ts`

`startAssistantContext(deps)`, where deps is the engine-side surface it needs:
`datasets(): DatasetInfo[]`, `onChange(listener)`, `describe(view): Promise<columns>`,
`activeDashboard(): string | undefined`, `timeRange(): {from,to} | undefined`,
`onLocation(listener)`, and `available: Observable<boolean>` (defaults to `isAssistantAvailable()`).

- Waits for `available === true`; otherwise does nothing.
- On each `dataset`/`dashboard` change event, and on a URL change that keeps the uid (time range): re-reads `datasets()`, DESCRIBEs each view whose
  table changed (cache by table name, so an unchanged dataset is not described again), rebuilds the
  digest, unregisters the previous page context and registers the new one. Rebuilds are serialized
  and coalesced so a burst of loads registers once at the end.
- Questions are registered once per dashboard (same uid pattern) while it has at least one dataset, and unregistered with its context.
- DESCRIBE runs on the explorer connections (not counted as activity). A failed DESCRIBE leaves
  that dataset's `columns` out; it never throws past the module.

### Wiring (`src/grafana/engine.ts`)

Right after `createEngineApi(...)`, call `startAssistantContext` with the API's `datasets`/
`onChange`, a `describe` that runs `DESCRIBE <view>` on the explorer path, the registry's active
dashboard, and the time range read from the URL (`from`/`to` through `locationService`, resolved
with `dateMath` to ISO; omitted when absent or unparsable). Started once per page, for the
engine's lifetime.

### Skills (`src/assistant/skills.ts`)

- `chaskiAssistantSkill`: datasets are hidden query variables of kind Dataset, read as `$name` in
  panel SQL; variable quoting; `$__timeFilter`, `$__timeFrom()`, `$__timeTo()`, `$__timeGroup`,
  `$__proxy('path')`; geometry as WKB hex vs `ST_AsGeoJSON` for maps; the two range-reuse rules;
  the Assistant cannot run Chaski queries — it writes SQL for panels; the live context lists the
  datasets and their columns.
- `dashboardAuthoringSkill`: the exact JSON of a dataset variable (`kind: 'dataset'`, `name`,
  `source` of type `sql` or `datasource`, `hide`, refresh) and of a panel query (`rawSql`), with a
  worked example exported as an object.

Tests hold the texts to the code: the macro names exist in `src/engine/macros.ts`, the example's
variable query satisfies `DatasetVariableQuery` and is accepted by the datasource's variable path,
`$name` matches how panel SQL resolves a dataset.

### Docs

- `docs/grafana-assistant.md`: what the Assistant sees, the skills to paste, the no-execution limit.
- README and `src/README.md`: a short "Grafana Assistant" section; CHANGELOG entry under Unreleased.
- `plugin.json`: add keyword `grafana assistant` (restart needed).
- Third-party licence notes if the repo keeps such a file (it does not today; then nothing).

## Testing

Jest only (no Assistant in the e2e Grafana):
- digest: mapping, ISO times, stale, missing columns.
- pageContext: SDK mocked; item shape; unregister.
- liveContext: fake deps; no registration when unavailable; re-registers on events; DESCRIBE
  cached per table; failures swallowed; questions registered once; coalescing.
- skills: the bindings above.
Plus `npm run typecheck`, `npm run lint`, `npm run build`.

## Out of scope

Skill manifest registration (needs an app plugin); exposing callable functions to the Assistant;
e2e against a real Assistant.
