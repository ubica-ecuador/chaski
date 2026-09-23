import { createBrowserRunner } from '../engine/browserRunner';
import { EngineStartError } from '../engine/errors';
import { DatasetRegistry } from '../engine/registry';
import { stats } from '../engine/stats';
import type { SqlRunner } from '../engine/types';
import { activity } from './activity';
import { leaveDashboardOnNavigation } from './dashboardKey';
import { type ChaskiEngineApi, createEngineApi, publishEngineApi } from './publicApi';

export interface Engine {
  runner: SqlRunner;
  registry: DatasetRegistry;
  version: string;
}

let enginePromise: Promise<Engine> | undefined;

/** The plugin's public folder as an absolute URL, whatever sub-path Grafana runs under. */
export function assetBase(): string {
  return new URL(__webpack_public_path__, document.baseURI).href;
}

/**
 * One engine per page, shared by every panel and every instance of this
 * datasource. The first instance to ask sets the memory limit. A failed start
 * is forgotten, so the next query retries. From its start, the engine's
 * registry hears when the user leaves a dashboard, for as long as the page lives.
 *
 * The public API (window.__chaski.engine()) is published when a start begins,
 * as a promise that settles with the start: other plugins asking during boot
 * wait for it instead of seeing undefined. A failed start rejects that promise
 * and publishes undefined again, until a later query retries.
 */
export function getEngine(memoryLimitMB: number): Promise<Engine> {
  if (!enginePromise) {
    let api: ChaskiEngineApi | undefined;
    enginePromise = createBrowserRunner({ assetBase: assetBase(), memoryLimitMB })
      .then((runner) => {
        const engine: Engine = { runner, registry: new DatasetRegistry(runner), version: runner.version };
        leaveDashboardOnNavigation(engine.registry);
        (window as unknown as { __duckdbwasm: unknown }).__duckdbwasm = { stats, runner };
        // Created here, before any caller of getEngine resumes, so it hears the first activation.
        api = createEngineApi({
          runner,
          registry: engine.registry,
          version: runner.version,
          track: (work) => activity.track(work),
        });
        return engine;
      })
      .catch((error: unknown) => {
        enginePromise = undefined;
        publishEngineApi(undefined);
        throw new EngineStartError(error);
      });
    const published = enginePromise.then(() => api!);
    // The query that started the engine reports a failed start; nobody has to handle this copy.
    published.catch(() => undefined);
    publishEngineApi(published);
  }
  return enginePromise;
}

/** Tests inject an engine on DuckDB's Node build instead of starting a browser one. */
export function setEngineForTests(engine: Engine | undefined): void {
  enginePromise = engine ? Promise.resolve(engine) : undefined;
}
