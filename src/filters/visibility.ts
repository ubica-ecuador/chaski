/*
 * A filters panel draws every control up front, and every control is a client
 * of the Selection: a brush moving in another panel sends each of them a query
 * per move, whether anyone sees it or not. In the pills and timeline layouts
 * most controls sit in closed popovers, so a drag across a busy dashboard
 * queued a dozen queries a step on the one DuckDB worker, ahead of the
 * dashboard's own panels, and the first drag built a pre-aggregated table for
 * each of them.
 *
 * A control no one can see now asks for nothing: its clients are disabled
 * while its element is out of view (a closed popover or section, a panel
 * scrolled away or in a collapsed row), and Mosaic keeps the latest request a
 * disabled client was sent and runs it once the client is enabled again, as
 * the control shows.
 */

/** What a Mosaic client offers for this: Mosaic defers a disabled client's queries. */
export interface Pausable {
  enabled: boolean;
}

export interface Watched {
  element: Element;
  clients: Pausable[];
}

type Observe = (callback: IntersectionObserverCallback, options: IntersectionObserverInit) => IntersectionObserver;

const intersections: Observe = (callback, options) => new IntersectionObserver(callback, options);

/** Out of view by this much, a control is about to show: it may query already. */
const MARGIN = '200px';

/**
 * Pauses each control's clients while its element is out of view. Returns the
 * undo, which only stops watching: it runs as the panel is torn down, when an
 * enabled client would send its deferred query to a coordinator going away.
 */
export function pauseWhileHidden(watched: Watched[], observe: Observe = intersections): () => void {
  const byElement = new Map(watched.map((w) => [w.element, w.clients] as const));
  const observer = observe(
    (entries) => {
      for (const entry of entries) {
        // A detached element (a closed popover) and one with display: none intersect nothing.
        const shown = entry.isIntersecting && entry.target.isConnected;
        for (const client of byElement.get(entry.target) ?? []) {
          client.enabled = shown;
        }
      }
    },
    { rootMargin: MARGIN }
  );
  byElement.forEach((_, element) => observer.observe(element));
  return () => observer.disconnect();
}
