import { isSelection, type MosaicClient, type Param, type Selection, type SelectionClause } from '@uwdata/mosaic-core';

import type { ChaskiEngineApi, DatasetInfo } from '../grafana/publicApi';
import { clauseColumns } from './bridge';

/*
 * What the Mosaic panels of one dashboard share. Each panel has its own
 * coordinator, but Params and Selections are shared by name, so a brush in one
 * panel filters the others; named plots are shared too, so a legend can sit in
 * another panel than its plot.
 */

/** Where pre-aggregated tables go. Dropped whole when a dataset reloads. */
export const PREAGG_SCHEMA = 'mosaic';

export interface Page {
  readonly key: string;
  readonly params: Map<string, Param<unknown> | Selection>;
  /** vgplot's named plots, taken from the first panel's API context. */
  namedPlots?: unknown;
  /** Bumped when a dataset reloads: every panel builds itself again. */
  readonly generation: number;
  subscribe(listener: () => void): () => void;
  /** Notes which version of these datasets the panels now show. */
  read(names: string[], datasets: DatasetInfo[]): void;
}

class PageState implements Page {
  readonly params = new Map<string, Param<unknown> | Selection>();
  namedPlots?: unknown;
  generation = 0;
  /** The datasets the panels read, by the `loadedAt` of the version they read. */
  readonly versions = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(readonly key: string) {}

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  read(names: string[], datasets: DatasetInfo[]) {
    for (const name of names) {
      const info = datasets.find((d) => d.name === name);
      if (info) {
        this.versions.set(name, info.loadedAt);
      }
    }
  }

  bump() {
    this.generation++;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * Clause sources of panels of other plugins (a kepler map, a Kepler Plus Time
 * Brush), which build their clauses through the runtime's builders. Their
 * values are times, places and picks, not the bins of data that reloaded, so
 * a reload keeps them: resetting them made a Time Brush open its window to the
 * whole range and write it, losing the reader's window on every refresh.
 */
const outside = new WeakSet<object>();

/** Notes a clause source as another plugin's (see `outside`). */
export function markOutside(source: unknown): void {
  if (typeof source === 'object' && source !== null) {
    outside.add(source);
  }
}

/**
 * Sources of the clauses that hold a range through a reload in place of a brush drawn over the old data, until
 * the panels built again show it (filters/sync.ts `reannounce`) and the next brush on its column replaces it.
 */
const holders = new WeakSet<object>();

/** Whether a clause source holds a range through a reload (see `holders`). */
export function isHolder(source: unknown): boolean {
  return typeof source === 'object' && source !== null && holders.has(source);
}

/** A copy of an interval clause with a value, held by no panel; undefined for any other clause. */
function holdRange(clause: SelectionClause): SelectionClause | undefined {
  if ((clause.meta as { type?: string } | undefined)?.type !== 'interval' || clause.value == null) {
    return undefined;
  }
  const source = { reset() {} };
  holders.add(source);
  return { ...clause, source, clients: new Set() } as SelectionClause;
}

/** The clauses a reload clears: those of this app's own panels, whose brushes were drawn over the old data. */
export function staleClauses(selection: Selection): Selection['clauses'] {
  return selection.clauses.filter((clause) => !outside.has(clause.source as object));
}

let current: PageState | undefined;
let engineWatched: ChaskiEngineApi | undefined;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;

/** The dashboard's uid from the path, `/d/<uid>/...`, or the path itself. */
export function dashboardKey(pathname: string = window.location.pathname): string {
  return pathname.match(/\/d\/([^/]+)/)?.[1] ?? pathname;
}

/**
 * The shared state of the dashboard on screen. Another dashboard starts from
 * nothing: its params are its own, and the old pre-aggregates are dropped.
 */
export function pageFor(key: string, engine: ChaskiEngineApi): Page {
  if (!current || current.key !== key) {
    const previous = current;
    current = new PageState(key);
    if (previous) {
      dropPreaggregates(engine);
    }
  }
  watch(engine);
  return current;
}

/**
 * A dataset that reloads makes every result stale: the query cache (each panel
 * builds a new coordinator), the pre-aggregated tables (whose names hash the
 * query, not the data) and the brushes, whose bins came from the old data. One
 * rebuild covers the events of several datasets loading together.
 *
 * Only a new version of a dataset some panel read counts. Chaski also reports
 * a dataset when its view first points at the version just loaded, often after
 * the panels have read it: that one changes nothing.
 *
 * The clauses of other plugins' panels stay (`outside`): the panels built
 * again apply them as they apply a clause landing from elsewhere.
 */
function watch(engine: ChaskiEngineApi) {
  if (engineWatched === engine) {
    return;
  }
  engineWatched = engine;
  engine.onChange((event) => {
    if (event.kind !== 'dataset' || !current) {
      return;
    }
    const page = current;
    const read = page.versions.get(event.name);
    const now = engine.datasets().find((d) => d.name === event.name)?.loadedAt;
    if (read === undefined || read === now) {
      return;
    }
    page.versions.delete(event.name);
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      await dropPreaggregates(engine);
      for (const param of page.params.values()) {
        if (!isSelection(param)) {
          continue;
        }
        const stale = staleClauses(param);
        // A range a brush held stays, held by no panel, before its brush's clause goes: the Selection never
        // goes without it. Taken out, a Time Brush linked to its column opened its window to the whole range
        // and wrote it, and the panels built again read that from the URL. Not on a column another plugin's
        // clause holds (a Time Brush moved during the reload): that one is the newer.
        const kept = new Set(
          param.clauses.filter((clause) => !stale.includes(clause)).flatMap((clause) => clauseColumns(clause))
        );
        for (const clause of stale) {
          const held = clauseColumns(clause).some((name) => kept.has(name)) ? undefined : holdRange(clause);
          if (held) {
            param.update(held);
          }
        }
        if (stale.length > 0) {
          param.reset(stale);
        }
      }
      page.bump();
    }, 100);
  });
}

function dropPreaggregates(engine: ChaskiEngineApi): Promise<void> {
  return engine
    .exec(`DROP SCHEMA IF EXISTS ${PREAGG_SCHEMA} CASCADE`)
    .catch((error: unknown) => console.warn('Mosaic: dropping pre-aggregates', error));
}

/**
 * Takes out of every shared selection the clauses a panel's clients made, as
 * the panel goes away: nothing would be left on screen to clear them with.
 *
 * Another plugin's clause stays (`outside`: a Time Brush's window), and so
 * does a range held through a reload (`holders`), even when the panel's
 * linked brushes widened them to their marks (filters/sync.ts `linkBrush`):
 * they only forget those clients. Taken out, they made a Time Brush open its
 * window each time a filters panel built itself again.
 */
export function releaseClauses(page: Page, clients: Iterable<MosaicClient>) {
  const mine = new Set<unknown>(clients);
  for (const param of page.params.values()) {
    if (!isSelection(param)) {
      continue;
    }
    const stays = (clause: SelectionClause) => outside.has(clause.source as object) || isHolder(clause.source);
    const owned = param.clauses.filter(
      (clause) =>
        !stays(clause) && (mine.has(clause.source) || [...(clause.clients ?? [])].some((client) => mine.has(client)))
    );
    if (owned.length > 0) {
      param.reset(owned);
    }
    for (const clause of param.clauses) {
      const widened = clause.clients ? [...clause.clients] : [];
      if (stays(clause) && widened.some((client) => mine.has(client))) {
        clause.clients = new Set(widened.filter((client) => !mine.has(client)));
      }
    }
  }
}

/** For tests: forget the page and the engine. */
export function resetPages() {
  current = undefined;
  engineWatched = undefined;
  clearTimeout(reloadTimer);
}
