/*
 * The filters panel counts again whenever the URL changes, and a brush that
 * writes as it moves (a Kepler Plus Time Brush, a rest mid-drag) changes it
 * many times a second. Each count is a scan of the whole dataset, and they
 * queued on the one DuckDB worker ahead of the dashboard's own panels: a
 * dozen per drag, each answered seconds late, and in no promised order.
 */

/**
 * Runs `work` for one input at a time, the latest: inputs that come in while
 * it runs replace one another, and only the last runs, once it is done. An
 * input of the same key as the one that last ran is dropped, as its answer
 * stands; after a failure, it runs again.
 */
export function latestOnly<T>(work: (input: T) => Promise<unknown>, keyOf: (input: T) => string): (input: T) => void {
  let running = false;
  let waiting: { input: T } | undefined;
  let lastKey: string | undefined;
  const push = (input: T) => {
    const key = keyOf(input);
    if (running) {
      waiting = { input };
      return;
    }
    if (key === lastKey) {
      return;
    }
    running = true;
    lastKey = key;
    work(input)
      .catch(() => {
        lastKey = undefined;
      })
      .finally(() => {
        running = false;
        const next = waiting;
        waiting = undefined;
        if (next) {
          push(next.input);
        }
      });
  };
  return push;
}
