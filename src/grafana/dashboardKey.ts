import { locationService } from '@grafana/runtime';

export interface DashboardKey {
  key: string;
  source: 'request' | 'location';
}

/** The uid in a dashboard's path (`/d/<uid>/…`); undefined on any other page. */
const uidIn = (pathname: string): string | undefined => /\/d\/([^/]+)/.exec(pathname)?.[1];

/**
 * Which dashboard a request belongs to. Panel requests carry `dashboardUID`;
 * variable requests may not, so the fallback reads it from the URL
 * (`/d/<uid>/…`). Outside a dashboard (Explore, a new unsaved one) every
 * request shares one key.
 */
export function dashboardKey(request?: { dashboardUID?: string }): DashboardKey {
  if (request?.dashboardUID) {
    return { key: request.dashboardUID, source: 'request' };
  }
  return { key: uidIn(locationService.getLocation().pathname) ?? 'no-dashboard', source: 'location' };
}

/**
 * Tells `registry` each time the dashboard in the URL changes: to another
 * dashboard, or to a page with none (Home, Explore, settings). Its requests
 * alone can't show a trip to a page this datasource doesn't serve and back,
 * which must start a new visit (see DatasetRegistry.leave). A change that keeps
 * the uid (the query string, the slug) stays within the visit. Returns the
 * function that stops listening.
 */
export function leaveDashboardOnNavigation(registry: { leave(): void }): () => void {
  let current = uidIn(locationService.getLocation().pathname);
  return locationService.getHistory().listen((location: { pathname: string }) => {
    const next = uidIn(location.pathname);
    if (next !== current) {
      current = next;
      registry.leave();
    }
  });
}
