import { tableFromArrays, tableToIPC } from 'apache-arrow';

import { columnsOf, urlTimeRange } from './assistant';

jest.mock('@grafana/runtime', () => ({ locationService: {} }));
jest.mock('@grafana/assistant', () => ({ isAssistantAvailable: jest.fn() }));

describe('urlTimeRange', () => {
  it('reads epoch milliseconds', () => {
    expect(urlTimeRange({ from: '1696000000000', to: '1696003600000' })).toEqual({
      from: '2023-09-29T15:06:40.000Z',
      to: '2023-09-29T16:06:40.000Z',
      raw: { from: '1696000000000', to: '1696003600000' },
    });
  });

  it('resolves relative ranges', () => {
    const range = urlTimeRange({ from: 'now-6h', to: 'now' })!;
    expect(range.raw).toEqual({ from: 'now-6h', to: 'now' });
    expect(Date.parse(range.to) - Date.parse(range.from)).toBeGreaterThanOrEqual(6 * 3600_000 - 1000);
    expect(Date.parse(range.to) - Date.parse(range.from)).toBeLessThanOrEqual(6 * 3600_000 + 1000);
  });

  it('omits what it cannot read', () => {
    expect(urlTimeRange({})).toBeUndefined();
    expect(urlTimeRange({ from: 'garbage', to: 'now' })).toBeUndefined();
    expect(urlTimeRange({ from: ['now-1h', 'now-2h'], to: 'now' })).toBeUndefined();
  });
});

it('reads DESCRIBE rows', () => {
  const ipc = tableToIPC(
    tableFromArrays({ column_name: ['route', 't'], column_type: ['VARCHAR', 'TIMESTAMP'], null: ['YES', 'YES'] })
  );
  expect(columnsOf(ipc)).toEqual([
    { name: 'route', type: 'VARCHAR' },
    { name: 't', type: 'TIMESTAMP' },
  ]);
});
