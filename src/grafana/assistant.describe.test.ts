/** @jest-environment node */
import { DatasetRegistry } from '../engine/registry';
import { createNodeRunner } from '../engine/testing/nodeRunner';
import { describeTable } from './assistant';
import { createEngineApi } from './publicApi';

jest.mock('@grafana/runtime', () => ({ locationService: {} }));
jest.mock('@grafana/assistant', () => ({ isAssistantAvailable: jest.fn() }));
jest.mock('@grafana/data', () => ({ dateMath: {}, dateTime: jest.fn() }));

it("describes a dataset's loaded version by its table, from an explorer connection", async () => {
  const runner = await createNodeRunner();
  const registry = new DatasetRegistry(runner);
  const api = createEngineApi({ runner, registry, version: 'v1.4.3', track: (work) => work() });
  await registry.activate('d');
  const state = await registry.load(
    'd',
    'sample',
    { kind: 'sql', sql: "SELECT range AS n, 'x' AS label FROM range(3)" },
    's1'
  );

  expect(await describeTable(api, state.table)).toEqual([
    { name: 'n', type: 'BIGINT' },
    { name: 'label', type: 'VARCHAR' },
  ]);
});
