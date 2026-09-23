import type { Table } from 'apache-arrow';

import { DATASETS_SCHEMA } from './datasetViews';
import type { SqlRunner, SqlSession } from './types';

export const SCRATCH_SCHEMA = 'explore';

/**
 * How an explorer connection is prepared. Unqualified writes land in explore,
 * not in main beside the panels' tables; unqualified reads find datasets by
 * name. `datasets` is created too: search_path refuses a schema that does not
 * exist yet.
 */
export const SESSION_SETUP = [
  `CREATE SCHEMA IF NOT EXISTS ${SCRATCH_SCHEMA}`,
  `CREATE SCHEMA IF NOT EXISTS ${DATASETS_SCHEMA}`,
  `USE ${SCRATCH_SCHEMA}`,
  `SET search_path = '${SCRATCH_SCHEMA},${DATASETS_SCHEMA}'`,
];

/** Connections the explorer may hold at once. Mosaic keeps several queries in flight. */
const POOL_SIZE = 4;

const aborted = () => new DOMException('The query was cancelled', 'AbortError');

/** A queued caller: settled exactly once, either with a session or with an error. */
interface Waiter {
  resolve(session: SqlSession): void;
  reject(error: unknown): void;
}

/**
 * The explorer's connections, and the scratch schema they write to. Each
 * connection serves one query at a time; queries beyond the pool's size wait
 * for one to come back. Nothing here stops an explicit write to main: DuckDB
 * has no per-connection permissions, so that is a documented convention.
 */
export class ScratchPool {
  private readonly idle: SqlSession[] = [];
  private readonly waiting: Waiter[] = [];
  private opened = 0;

  constructor(
    private readonly runner: SqlRunner,
    private readonly size = POOL_SIZE
  ) {}

  async query(sql: string, signal?: AbortSignal): Promise<Table> {
    const session = await this.acquire(signal);
    try {
      return await session.query(sql, signal);
    } finally {
      this.giveBack(session);
    }
  }

  /** Drops everything in explore and recreates it empty. `datasets` and `main` are untouched. */
  async releaseScratch(): Promise<void> {
    await this.runner.exec(`DROP SCHEMA IF EXISTS ${SCRATCH_SCHEMA} CASCADE; CREATE SCHEMA ${SCRATCH_SCHEMA}`);
  }

  private async acquire(signal?: AbortSignal): Promise<SqlSession> {
    if (signal?.aborted) {
      throw aborted();
    }
    const idle = this.idle.pop();
    if (idle) {
      return idle;
    }
    if (this.opened < this.size) {
      try {
        return await this.open();
      } catch (error) {
        // The slot `open` just freed up again; a queued caller can try it next.
        this.serveNextWaiter();
        throw error;
      }
    }
    return new Promise<SqlSession>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        const index = this.waiting.indexOf(waiter);
        if (index !== -1) {
          this.waiting.splice(index, 1);
        }
        settled = true;
        reject(aborted());
      };
      const waiter: Waiter = {
        resolve: (session) => {
          if (settled) {
            // Aborted after being pulled off the queue to open a connection for it: don't strand it.
            this.giveBack(session);
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          resolve(session);
        },
        reject: (error) => {
          if (settled) {
            return;
          }
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(waiter);
    });
  }

  /** Opens one connection, counted against `size`. On failure the slot is freed again. */
  private async open(): Promise<SqlSession> {
    if (!this.runner.openSession) {
      throw new Error('This engine cannot open explorer connections');
    }
    this.opened++;
    try {
      return await this.runner.openSession(SESSION_SETUP);
    } catch (error) {
      this.opened--;
      throw error;
    }
  }

  /**
   * A slot just freed up (a session came back, or an open attempt failed).
   * Hand it to the next queued caller by opening a fresh connection for it -
   * and if that open fails too, try the caller behind it, and so on, so a run
   * of failures rejects every waiter instead of stranding the ones behind the
   * first.
   */
  private serveNextWaiter(): void {
    const waiter = this.waiting.shift();
    if (!waiter) {
      return;
    }
    void this.open().then(
      (session) => waiter.resolve(session),
      (error) => {
        waiter.reject(error);
        this.serveNextWaiter();
      }
    );
  }

  private giveBack(session: SqlSession): void {
    const next = this.waiting.shift();
    if (next) {
      next.resolve(session);
    } else {
      this.idle.push(session);
    }
  }
}
