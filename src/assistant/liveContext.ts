import type { Observable } from 'rxjs';

import type { ChangeEvent, DatasetInfo } from '../grafana/publicApi';
import { buildAssistantDigest, type AssistantDigest, type DigestColumn, type DigestTimeRange } from './digest';
import { registerAssistant } from './pageContext';

export interface LiveContextDeps {
  /** The datasets of the dashboard on screen. */
  datasets(): DatasetInfo[];
  onChange(listener: (event: ChangeEvent) => void): () => void;
  /**
   * The columns of one loaded version, by its physical table. Not the view:
   * the registry reports a new table before the view is re-pointed at it, and
   * the columns are cached under the table's name.
   */
  describe(table: string): Promise<DigestColumn[]>;
  activeDashboard(): string | undefined;
  timeRange(): DigestTimeRange | undefined;
  /** Called on URL changes that stay on the active dashboard, so a new time range reaches the digest. */
  onLocation(listener: () => void): () => void;
  available: Observable<boolean>;
  /** Registers a digest with the Assistant; returns the unregister fn. */
  register?: (digest: AssistantDigest) => () => void;
}

/**
 * Keeps the Grafana Assistant's page context in step with the datasets on
 * screen, for as long as the Assistant is available. Rebuilds run one at a
 * time and coalesce: events arriving during a rebuild yield one more rebuild,
 * not one each. Each table (one per loaded version) is described once, and an
 * unchanged digest is not registered again. Nothing here throws to the
 * engine: a failed rebuild leaves the last registration.
 *
 * Returns the function that stops it; `stop.settled()` resolves once the
 * rebuilds queued so far are done.
 */
export function startAssistantContext(deps: LiveContextDeps) {
  const register = deps.register ?? registerAssistant;
  const columns = new Map<string, DigestColumn[]>();
  let enabled = false;
  let current: { key: string; unregister: () => void } | undefined;
  let dirty = false;
  let looping = false;
  let running: Promise<void> = Promise.resolve();

  const clear = () => {
    current?.unregister();
    current = undefined;
  };

  const rebuild = async () => {
    const dashboard = deps.activeDashboard();
    const list = dashboard && dashboard !== 'no-dashboard' ? deps.datasets() : [];
    for (const dataset of list) {
      if (!columns.has(dataset.table)) {
        const described = await deps.describe(dataset.table).catch(() => undefined);
        if (described) {
          columns.set(dataset.table, described);
        }
      }
    }
    const live = new Set(list.map((dataset) => dataset.table));
    for (const table of [...columns.keys()]) {
      if (!live.has(table)) {
        columns.delete(table);
      }
    }
    // The Assistant may have gone, or the controller stopped, while DESCRIBE ran.
    if (!enabled) {
      return;
    }
    if (!dashboard || list.length === 0) {
      clear();
      return;
    }
    const digest = buildAssistantDigest({ dashboard, datasets: list, columns, timeRange: deps.timeRange() });
    // A relative range resolves to a later `now` on every rebuild; only a change
    // of the range as written counts, or every rebuild would re-register.
    const key = JSON.stringify({ ...digest, timeRange: digest.timeRange?.raw ?? digest.timeRange });
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
          console.warn('Chaski: Grafana Assistant context', error);
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
