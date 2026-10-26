import type {
  ArrowQueryRequest,
  ConnectorQueryOptions,
  ConnectorQueryRequest,
  ExecQueryRequest,
} from '@uwdata/mosaic-core';

import type { ChaskiEngineApi, ChaskiGlobal } from '../grafana/publicApi';

/*
 * The panel reaches the engine the way any other plugin does, through
 * window.__chaski: it is a bundle of its own, and importing the engine would
 * start a second one. Only the API's types come from the datasource's code.
 */

type ChaskiWindow = { __chaski?: ChaskiGlobal };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

/**
 * Chaski's engine, once a Chaski query on this page has started it.
 *
 * engine() never starts the engine: a dashboard's dataset variables do, as the
 * dashboard loads. Until then it is undefined, and a failed start makes it
 * undefined again until a later query retries, so this keeps looking, every
 * quarter second at first and every second after ten.
 */
export async function waitForEngine(signal: AbortSignal, target: object = window): Promise<ChaskiEngineApi> {
  const started = Date.now();
  for (;;) {
    signal.throwIfAborted();
    const pending = (target as ChaskiWindow).__chaski?.engine();
    if (pending) {
      try {
        return await pending;
      } catch {
        // The start failed; the next Chaski query retries it.
      }
    }
    await sleep(Date.now() - started < 10_000 ? 250 : 1000, signal);
  }
}

/** The datasets of these names that cannot be read yet: not loaded, or their view not made. */
export async function unreadable(engine: ChaskiEngineApi, names: string[], signal: AbortSignal): Promise<string[]> {
  const missing: string[] = [];
  for (const name of names) {
    try {
      await engine.exec(`SELECT * FROM datasets."${name.replace(/"/g, '""')}" LIMIT 0`, { signal });
    } catch {
      missing.push(name);
    }
  }
  return missing;
}

/**
 * DuckDB refuses the second of two transactions that create the same catalog
 * entry at once. Mosaic's preaggregator does exactly that when two clients
 * share a preaggregated table: each sends CREATE TABLE IF NOT EXISTS on its
 * own connection, and the slower commit fails. Run again, the statement finds
 * the table the first one made and does nothing.
 */
const CATALOG_CONFLICT = /write-write conflict/i;
const CONFLICT_RETRIES = [50, 250, 1000];

async function execRetryingConflicts(
  engine: ChaskiEngineApi,
  sql: string,
  opts: { signal?: AbortSignal }
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await engine.exec(sql, opts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= CONFLICT_RETRIES.length || !CATALOG_CONFLICT.test(message) || opts.signal?.aborted) {
        throw error;
      }
      await sleep(CONFLICT_RETRIES[attempt], opts.signal);
    }
  }
}

export interface ConnectorHooks {
  /** A query answered; `startedAt` is when it was sent, by `performance.now()`. */
  onAnswer?: (startedAt: number) => void;
}

/**
 * A Mosaic connector on Chaski's engine. Queries run on the explorer's
 * connections: unqualified names find the dashboard's datasets, and Mosaic
 * may keep several queries in flight.
 */
export class ChaskiConnector {
  constructor(
    private readonly engine: ChaskiEngineApi,
    private readonly hooks: ConnectorHooks = {}
  ) {}

  query(query: ArrowQueryRequest, options?: ConnectorQueryOptions): Promise<Uint8Array>;
  query(query: ExecQueryRequest, options?: ConnectorQueryOptions): Promise<void>;
  async query(query: ConnectorQueryRequest, options?: ConnectorQueryOptions): Promise<Uint8Array | void> {
    const opts = { signal: options?.signal };
    const startedAt = performance.now();
    const result =
      query.type === 'exec'
        ? await execRetryingConflicts(this.engine, query.sql, opts)
        : await this.engine.queryIPC(query.sql, opts);
    this.hooks.onAnswer?.(startedAt);
    return result;
  }
}
