import { Param, Selection } from '@uwdata/mosaic-core';

import type { ChaskiEngineApi } from '../grafana/publicApi';
import { pageFor, resetPages } from './page';
import { sharedSelection } from './shared';

const engine: ChaskiEngineApi = {
  duckdbVersion: 'v1.4.3',
  queryIPC: jest.fn(),
  exec: jest.fn(async () => {}),
  datasets: () => [],
  onChange: () => () => {},
  releaseScratch: async () => {},
};

beforeEach(() => {
  resetPages();
  window.history.pushState({}, '', '/d/taxi/nyc');
  (window as unknown as { __chaski: unknown }).__chaski = { engine: () => Promise.resolve(engine) };
});

afterEach(() => {
  delete (window as unknown as { __chaski?: unknown }).__chaski;
});

it('makes a crossfilter Selection on the page when no panel has', async () => {
  const selection = await sharedSelection('brush', new AbortController().signal);
  expect(selection.resolver.cross).toBe(true);
  expect(pageFor('taxi', engine).params.get('brush')).toBe(selection);
  expect(await sharedSelection('brush', new AbortController().signal)).toBe(selection);
});

it('takes the Selection a Mosaic panel already made', async () => {
  const made = Selection.intersect();
  pageFor('taxi', engine).params.set('brush', made);
  expect(await sharedSelection('brush', new AbortController().signal)).toBe(made);
});

it('refuses a param of that name that is not a Selection', async () => {
  pageFor('taxi', engine).params.set('bins', Param.value(20));
  await expect(sharedSelection('bins', new AbortController().signal)).rejects.toThrow('not a Selection');
});
