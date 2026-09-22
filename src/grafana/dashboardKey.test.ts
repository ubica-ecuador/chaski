import { locationService } from '@grafana/runtime';

import { dashboardKey, leaveDashboardOnNavigation } from './dashboardKey';

jest.mock('@grafana/runtime', () => ({ locationService: { getLocation: jest.fn(), getHistory: jest.fn() } }));

const getLocation = locationService.getLocation as jest.Mock;
const getHistory = locationService.getHistory as jest.Mock;

describe('dashboardKey', () => {
  it('prefers the uid the request carries', () => {
    getLocation.mockReturnValue({ pathname: '/d/abc/title' });
    expect(dashboardKey({ dashboardUID: 'xyz' })).toEqual({ key: 'xyz', source: 'request' });
  });

  it('falls back to the dashboard in the URL', () => {
    getLocation.mockReturnValue({ pathname: '/d/abc/title' });
    expect(dashboardKey({})).toEqual({ key: 'abc', source: 'location' });
  });

  it('shares one key outside dashboards', () => {
    getLocation.mockReturnValue({ pathname: '/explore' });
    expect(dashboardKey()).toEqual({ key: 'no-dashboard', source: 'location' });
  });
});

describe('leaveDashboardOnNavigation', () => {
  /** Grafana's history, starting on `pathname`; `go` navigates as a push or browser Back would. */
  function history(pathname: string) {
    const listeners = new Set<(location: { pathname: string }) => void>();
    getLocation.mockReturnValue({ pathname });
    getHistory.mockReturnValue({
      listen: (listener: (location: { pathname: string }) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    return { go: (to: string) => listeners.forEach((listener) => listener({ pathname: to })) };
  }

  it('tells the registry each time the dashboard on screen is left', () => {
    const { go } = history('/d/abc/title');
    const registry = { leave: jest.fn() };
    leaveDashboardOnNavigation(registry);

    go('/d/abc/title'); // only the query string moved: a new time range, a panel opened for editing
    go('/d/abc/renamed');
    expect(registry.leave).not.toHaveBeenCalled();
    go('/'); // Home, where this datasource sends nothing
    expect(registry.leave).toHaveBeenCalledTimes(1);
    go('/explore');
    expect(registry.leave).toHaveBeenCalledTimes(1);
    go('/d/abc/title'); // back again
    expect(registry.leave).toHaveBeenCalledTimes(2);
    go('/d/other/elsewhere'); // straight to another dashboard
    expect(registry.leave).toHaveBeenCalledTimes(3);
  });

  it('stops listening when asked', () => {
    const { go } = history('/d/abc/title');
    const registry = { leave: jest.fn() };
    const stop = leaveDashboardOnNavigation(registry);
    stop();
    go('/');
    expect(registry.leave).not.toHaveBeenCalled();
  });
});
