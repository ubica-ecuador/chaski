import { buildAssistantDigest } from './digest';

const base = {
  name: 'vehicles',
  view: 'datasets."vehicles"',
  table: 't_vehicles_3',
  rows: 120,
  loadedAt: Date.UTC(2026, 9, 7, 12),
};

describe('buildAssistantDigest', () => {
  it('describes each dataset the way panel SQL and the explorer read it', () => {
    const digest = buildAssistantDigest({
      dashboard: 'abc',
      datasets: [base],
      columns: new Map([['t_vehicles_3', [{ name: 'route', type: 'VARCHAR' }]]]),
      timeRange: { from: '2026-10-07T06:00:00.000Z', to: '2026-10-07T12:00:00.000Z' },
    });
    expect(digest).toEqual({
      dashboard: 'abc',
      datasets: [
        {
          name: 'vehicles',
          panelSql: '$vehicles',
          view: 'datasets."vehicles"',
          rows: 120,
          loadedAt: '2026-10-07T12:00:00.000Z',
          columns: [{ name: 'route', type: 'VARCHAR' }],
        },
      ],
      timeRange: { from: '2026-10-07T06:00:00.000Z', to: '2026-10-07T12:00:00.000Z' },
    });
  });

  it('says when the data is stale and leaves out columns it could not describe', () => {
    const digest = buildAssistantDigest({
      dashboard: 'abc',
      datasets: [{ ...base, stale: 'HTTP 503' }],
      columns: new Map(),
    });
    expect(digest.datasets[0].stale).toBe('HTTP 503');
    expect(digest.datasets[0]).not.toHaveProperty('columns');
    expect(digest).not.toHaveProperty('timeRange');
  });
});
