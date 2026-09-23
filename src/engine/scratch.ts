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

/**
 * The explorer's connections, and the scratch schema they write to. Each
 * connection serves one query at a time; queries beyond the pool's size wait
 * for one to come back. Nothing here stops an explicit write to main: DuckDB
 * has no per-connection permissions, so that is a documented convention.
 */
export class ScratchPool {
  private readonly idle: SqlSession[] = [];
  private readonly waiting: Array<(session: SqlSession) => void> = [];
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
    return new Promise<SqlSession>((resolve, reject) => {
      const onAbort = () => {
        const index = this.waiting.indexOf(take);
        if (index !== -1) {
          this.waiting.splice(index, 1);
        }
        reject(aborted());
      };
      const take = (session: SqlSession) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(session);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(take);
    });
  }

  private giveBack(session: SqlSession): void {
    const next = this.waiting.shift();
    if (next) {
      next(session);
    } else {
      this.idle.push(session);
    }
  }
}
