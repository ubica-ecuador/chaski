import {
  createDataFrame,
  type DataFrame,
  type DataQueryError,
  type DataQueryRequest,
  type DataQueryResponse,
  DataSourceApi,
  type DataSourceGetTagValuesOptions,
  type DataSourceInstanceSettings,
  FieldType,
  type MetricFindValue,
  type TestDataSourceResponse,
} from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import type { DataQuery } from '@grafana/schema';
import { Observable } from 'rxjs';

import { explainError } from './engine/errors';
import { describe as describeColumns, runPanelQuery } from './engine/executor';
import { decideDatasetLoad, type LoadWindow } from './engine/rangeReuse';
import { quoteIdent } from './engine/sql';
import { SingleFlight } from './engine/singleFlight';
import { recordKey, recordLoad, recordQuery, recordReuse, recordShared } from './engine/stats';
import type { AdHocFilter, DatasetLoader } from './engine/types';
import { activity } from './grafana/activity';
import { arrowToDataFrame } from './grafana/arrowToFrame';
import { dashboardKey } from './grafana/dashboardKey';
import { rangeOf, scopedTimeOf, windowOf } from './grafana/datasetWindow';
import { type Engine, getEngine } from './grafana/engine';
import { loadFromDatasource } from './grafana/externalSource';
import { interpolateSql } from './grafana/interpolate';
import { staleNotices } from './grafana/notices';
import { DuckVariableSupport } from './grafana/variableSupport';
import {
  DEFAULT_MEMORY_LIMIT_MB,
  DEFAULT_QUERY,
  type DuckOptions,
  type DuckQuery,
  type DuckVariableQuery,
} from './types';

/** A panel request ready to run: its targets' SQL interpolated once, before anything runs. */
interface PanelPlan {
  engine: Engine;
  dashboard: string;
  panelId?: number;
  filters: AdHocFilter[];
  /** In request order; a target whose SQL could not be interpolated carries its error message instead. */
  targets: Array<{ refId: string; sql: string } | { refId: string; failed: string }>;
}

export class DataSource extends DataSourceApi<DuckQuery, DuckOptions> {
  readonly memoryLimitMB: number;
  private readonly panelsInFlight = new SingleFlight<DataQueryResponse>();

  constructor(instanceSettings: DataSourceInstanceSettings<DuckOptions>) {
    super(instanceSettings);
    this.memoryLimitMB = instanceSettings.jsonData.memoryLimitMB ?? DEFAULT_MEMORY_LIMIT_MB;
    this.variables = new DuckVariableSupport(this);
  }

  getDefaultQuery(): Partial<DuckQuery> {
    return DEFAULT_QUERY;
  }

  filterQuery(query: DuckQuery): boolean {
    return !query.hide && Boolean(query.rawSql?.trim());
  }

  query(request: DataQueryRequest<DuckQuery>): Observable<DataQueryResponse> {
    return abortable((signal) => activity.track(() => this.answerPanel(request, signal)));
  }

  variableQuery(request: DataQueryRequest<DuckVariableQuery>): Observable<DataQueryResponse> {
    return abortable(() => activity.track(() => this.runVariableQuery(request)));
  }

  /**
   * Runs a panel request, or joins the identical one already in flight. When
   * two variables change together (kepler's window), Grafana's scenes can send
   * a panel's request twice at once and keep both; the same SQL on the same
   * panel gives the same answer, so both get it from one execution.
   */
  private async answerPanel(request: DataQueryRequest<DuckQuery>, signal: AbortSignal): Promise<DataQueryResponse> {
    const planned = await this.planPanelQueries(request);
    if ('answer' in planned) {
      return planned.answer;
    }
    const { plan } = planned;
    const response = await this.panelsInFlight.run(
      panelKey(plan),
      (shared) => this.executePanelPlan(plan, shared),
      signal,
      () => recordShared({ panelId: request.panelId, at: Date.now() })
    );
    return ownCopy(response);
  }

  async runPanelQueries(request: DataQueryRequest<DuckQuery>, signal?: AbortSignal): Promise<DataQueryResponse> {
    const planned = await this.planPanelQueries(request);
    return 'answer' in planned ? planned.answer : this.executePanelPlan(planned.plan, signal);
  }

  /** Everything a panel request's answer depends on, or the answer itself when nothing is left to run. */
  private async planPanelQueries(
    request: DataQueryRequest<DuckQuery>
  ): Promise<{ plan: PanelPlan } | { answer: DataQueryResponse }> {
    const targets = request.targets.filter((target) => this.filterQuery(target));
    if (targets.length === 0) {
      return { answer: { data: [] } };
    }
    let engine: Engine;
    try {
      engine = await getEngine(this.memoryLimitMB);
    } catch (error) {
      const message = explainError(error, this.memoryLimitMB).message;
      return { answer: { data: [], errors: targets.map((target) => ({ refId: target.refId, message })) } };
    }
    const { key, source } = dashboardKey(request);
    recordKey({ kind: 'panel', source, key });
    await engine.registry.activate(key);
    return {
      plan: {
        engine,
        dashboard: key,
        panelId: request.panelId,
        filters: (request.filters ?? []) as AdHocFilter[],
        targets: targets.map((target) => {
          try {
            return { refId: target.refId, sql: this.interpolate(engine, target.rawSql, request) };
          } catch (error) {
            return { refId: target.refId, failed: explainError(error, this.memoryLimitMB).message };
          }
        }),
      },
    };
  }

  /**
   * Runs the plan's targets in order. Once `signal` aborts, nobody is waiting
   * for the answer, so the targets not yet started are skipped and nothing is
   * recorded for them: `stats.queries` only lists what ran.
   */
  private async executePanelPlan(plan: PanelPlan, signal?: AbortSignal): Promise<DataQueryResponse> {
    const { engine, dashboard, panelId } = plan;
    const data: DataFrame[] = [];
    const errors: DataQueryError[] = [];
    for (const target of plan.targets) {
      if (signal?.aborted) {
        break;
      }
      if ('failed' in target) {
        recordQuery({ refId: target.refId, ms: 0, rows: 0, ok: false, at: Date.now(), panelId });
        errors.push({ refId: target.refId, message: target.failed });
        continue;
      }
      try {
        const result = await runPanelQuery(engine.runner, target.sql, { filters: plan.filters, signal });
        const frame = arrowToDataFrame(result.table, target.refId);
        frame.meta = {
          executedQueryString: result.executed,
          notices: staleNotices(engine.registry.list(dashboard), result.executed, Date.now()),
          stats: [{ displayName: 'Engine time', value: Math.round(result.ms), unit: 'ms' }],
        };
        recordQuery({
          refId: target.refId,
          ms: result.ms,
          rows: result.table.numRows,
          ok: true,
          at: Date.now(),
          panelId,
        });
        data.push(frame);
      } catch (error) {
        recordQuery({ refId: target.refId, ms: 0, rows: 0, ok: false, at: Date.now(), panelId });
        errors.push({ refId: target.refId, message: explainError(error, this.memoryLimitMB).message });
      }
    }
    return errors.length > 0 ? { data, errors } : { data };
  }

  async runVariableQuery(request: DataQueryRequest<DuckVariableQuery>): Promise<DataQueryResponse> {
    const query = request.targets[0];
    let engine: Engine;
    try {
      engine = await getEngine(this.memoryLimitMB);
    } catch (error) {
      throw this.explain(error);
    }
    const { key, source } = dashboardKey(request);
    recordKey({ kind: 'variable', source, key });
    await engine.registry.activate(key);

    if (query?.kind === 'dataset') {
      const name = query.name?.trim();
      if (!name) {
        throw new Error('A dataset variable needs a name');
      }
      const source = query.source;
      const window = windowOf(request.range);
      // The source as it reads with its range pinned to `at`. Two windows giving
      // the same text mean only the range moved (see decideDatasetLoad).
      const signatureAt = (at: LoadWindow): string =>
        source.type === 'sql'
          ? this.interpolate(engine, source.sql, { ...request, range: rangeOf(at) })
          : JSON.stringify([
              getTemplateSrv().replace(JSON.stringify(source), { ...request.scopedVars, ...scopedTimeOf(at) }),
              at.from,
              at.to,
            ]);

      const loaded = engine.registry.loadedWindow(key, name);
      let signatureAtLoadedWindow: string | undefined;
      try {
        signatureAtLoadedWindow = loaded ? signatureAt(loaded.window) : undefined;
      } catch {
        signatureAtLoadedWindow = undefined;
      }
      const decision = decideDatasetLoad(loaded, {
        window,
        signatureAtLoadedWindow,
        visit: engine.registry.visitOf(key),
        loading: engine.registry.isLoading(key, name),
      });
      const current = engine.registry.get(key, name);
      if (decision === 'reuse' && current) {
        recordReuse({ name, at: Date.now() });
        return { data: [textValueFrame([current.table], [current.table])] };
      }

      const signature = signatureAt(window);
      const loader: DatasetLoader =
        source.type === 'sql'
          ? { kind: 'sql', sql: signature }
          : { kind: 'arrow', fetch: () => loadFromDatasource(source, request as DataQueryRequest<DataQuery>) };
      const started = performance.now();
      try {
        const state = await engine.registry.load(key, name, loader, signature, window);
        recordLoad({ name, ms: performance.now() - started, rows: state.rows, ok: !state.stale, at: Date.now() });
        // An orphaned load from before a dashboard switch can resolve with a
        // table the registry already dropped; the live entry is the one
        // Grafana must get, if a fresher one has since taken its place.
        const live = engine.registry.get(key, name) ?? state;
        return { data: [textValueFrame([live.table], [live.table])] };
      } catch (error) {
        recordLoad({ name, ms: performance.now() - started, rows: 0, ok: false, at: Date.now() });
        throw new Error(explainError(error, this.memoryLimitMB).message);
      }
    }

    if (query?.kind === 'values') {
      try {
        const result = await runPanelQuery(engine.runner, this.interpolate(engine, query.sql ?? '', request));
        const frame = arrowToDataFrame(result.table, 'values');
        const valueField = frame.fields[0];
        const textField = frame.fields[1] ?? valueField;
        return { data: [textValueFrame(asText(textField?.values), asText(valueField?.values))] };
      } catch (error) {
        throw this.explain(error);
      }
    }

    throw new Error('Unknown variable query: expected kind "dataset" or "values"');
  }

  async testDatasource(): Promise<TestDataSourceResponse> {
    try {
      const engine = await getEngine(this.memoryLimitMB);
      return { status: 'success', message: `DuckDB ${engine.version} is running in the browser.` };
    } catch (error) {
      return { status: 'error', message: explainError(error, this.memoryLimitMB).message };
    }
  }

  async getTagKeys(): Promise<MetricFindValue[]> {
    try {
      const engine = await getEngine(this.memoryLimitMB);
      const names = new Set<string>();
      for (const state of engine.registry.list(dashboardKey().key)) {
        for (const column of await describeColumns(engine.runner, `SELECT * FROM ${quoteIdent(state.table)}`)) {
          names.add(column.name);
        }
      }
      return [...names].sort().map((text) => ({ text }));
    } catch (error) {
      throw this.explain(error);
    }
  }

  async getTagValues(options: DataSourceGetTagValuesOptions<DuckQuery>): Promise<MetricFindValue[]> {
    try {
      const engine = await getEngine(this.memoryLimitMB);
      const values = new Set<string>();
      const column = quoteIdent(options.key);
      for (const state of engine.registry.list(dashboardKey().key)) {
        const columns = await describeColumns(engine.runner, `SELECT * FROM ${quoteIdent(state.table)}`);
        if (!columns.some((c) => c.name === options.key)) {
          continue;
        }
        const result = await engine.runner.query(
          `SELECT DISTINCT CAST(${column} AS VARCHAR) AS v FROM ${quoteIdent(state.table)} WHERE ${column} IS NOT NULL LIMIT 1000`
        );
        for (const row of result.toArray()) {
          values.add(String(row.v));
        }
      }
      return [...values].sort().map((text) => ({ text }));
    } catch (error) {
      throw this.explain(error);
    }
  }

  private interpolate(engine: Engine, sql: string, request: DataQueryRequest<DataQuery>): string {
    return interpolateSql(sql, {
      templateSrv: getTemplateSrv(),
      scopedVars: request.scopedVars,
      range: request.range,
      isDatasetTable: (name) => engine.registry.byTable(name) !== undefined,
    });
  }

  /** Turns any error into the same actionable message `runPanelQueries` and `testDatasource` give. */
  private explain(error: unknown): Error {
    return new Error(explainError(error, this.memoryLimitMB).message);
  }
}

function textValueFrame(text: string[], value: string[]): DataFrame {
  return createDataFrame({
    refId: 'variable',
    fields: [
      { name: 'text', type: FieldType.string, values: text },
      { name: 'value', type: FieldType.string, values: value },
    ],
  });
}

function asText(values: unknown[] | undefined): string[] {
  return (values ?? []).map((v) => (v === null || v === undefined ? '' : String(v)));
}

/**
 * What two panel requests must share to get the same answer: the dashboard,
 * the panel, the ad hoc filters and, target by target, the refId and the SQL
 * as interpolated, which carries the variables' values and the time range.
 * It is built from the very plan that runs, so it can't drift from it.
 */
function panelKey(plan: PanelPlan): string {
  return JSON.stringify([
    plan.dashboard,
    plan.panelId ?? null,
    plan.filters,
    plan.targets.map((target) => ('sql' in target ? [target.refId, target.sql] : [target.refId, null, target.failed])),
  ]);
}

/**
 * Each request's own response when requests share an execution. Grafana writes
 * to the frames and fields it gets (it resets every `field.state` on arrival,
 * and caches reductions there), so the response, frames, fields, their config
 * and the frame meta are copied. The column values, the only large part, are
 * shared: nothing writes to them.
 */
function ownCopy(response: DataQueryResponse): DataQueryResponse {
  const copy: DataQueryResponse = {
    ...response,
    data: response.data.map((frame: DataFrame) => ({
      ...frame,
      meta: frame.meta && { ...frame.meta },
      fields: frame.fields.map((field) => ({ ...field, config: { ...field.config } })),
    })),
  };
  if (response.errors) {
    copy.errors = response.errors.map((error) => ({ ...error }));
  }
  return copy;
}

/** An Observable whose unsubscription (Grafana abandoning a query) aborts the work. */
function abortable<T>(run: (signal: AbortSignal) => Promise<T>): Observable<T> {
  return new Observable<T>((subscriber) => {
    const controller = new AbortController();
    run(controller.signal).then(
      (value) => {
        subscriber.next(value);
        subscriber.complete();
      },
      (error: unknown) => subscriber.error(error)
    );
    return () => controller.abort();
  });
}
