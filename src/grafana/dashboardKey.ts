import { locationService } from '@grafana/runtime';

export interface DashboardKey {
  key: string;
  source: 'request' | 'location';
}

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
  const match = /\/d\/([^/]+)/.exec(locationService.getLocation().pathname);
  return { key: match?.[1] ?? 'no-dashboard', source: 'location' };
}
