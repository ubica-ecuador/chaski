import { locationService } from '@grafana/runtime';

import { dashboardKey } from './dashboardKey';

jest.mock('@grafana/runtime', () => ({ locationService: { getLocation: jest.fn() } }));

const getLocation = locationService.getLocation as jest.Mock;

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
