import { createBrowserRunner } from '../engine/browserRunner';
import { EngineStartError } from '../engine/errors';
import { DatasetRegistry } from '../engine/registry';
import { stats } from '../engine/stats';
import type { SqlRunner } from '../engine/types';
import { activity } from './activity';
import { leaveDashboardOnNavigation } from './dashboardKey';
import { createEngineApi, publishEngineApi } from './publicApi';

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
 */
export function getEngine(memoryLimitMB: number): Promise<Engine> {
  if (!enginePromise) {
    enginePromise = createBrowserRunner({ assetBase: assetBase(), memoryLimitMB })
      .then((runner) => {
        const engine: Engine = { runner, registry: new DatasetRegistry(runner), version: runner.version };
        leaveDashboardOnNavigation(engine.registry);
        (window as unknown as { __duckdbwasm: unknown }).__duckdbwasm = { stats, runner };
        publishEngineApi(
          Promise.resolve(
            createEngineApi({
              runner,
              registry: engine.registry,
              version: runner.version,
              track: (work) => activity.track(work),
            })
          )
        );
        return engine;
      })
      .catch((error: unknown) => {
        enginePromise = undefined;
        publishEngineApi(undefined);
        throw new EngineStartError(error);
      });
  }
  return enginePromise;
}

/** Tests inject an engine on DuckDB's Node build instead of starting a browser one. */
export function setEngineForTests(engine: Engine | undefined): void {
  enginePromise = engine ? Promise.resolve(engine) : undefined;
}
