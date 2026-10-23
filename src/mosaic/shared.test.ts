import { Param, Selection } from '@uwdata/mosaic-core';

import type { ChaskiEngineApi } from '../grafana/publicApi';
import { pageFor, resetPages } from './page';
import { clauseArea, sharedSelection } from './shared';

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
  pageFor('taxi', engine).params.set('bins', Param.value<unknown>(20));
  await expect(sharedSelection('bins', new AbortController().signal)).rejects.toThrow('not a Selection');
});

it('makes an area clause of a drawn polygon, bounding box first, and an empty one of anything else', () => {
  const source = {};
  const clause = clauseArea(['lng', 'lat'], 'POLYGON((0 0, 2 0, 2 1, 0 0))', { source });
  expect(clause.meta).toEqual({ type: 'area' });
  expect(clause.value).toBe('POLYGON((0 0, 2 0, 2 1, 0 0))');
  expect(String(clause.predicate)).toBe(
    '(("lng" BETWEEN 0 AND 2) AND ("lat" BETWEEN 0 AND 1) AND ST_Contains(ST_GeomFromText(\'POLYGON((0 0, 2 0, 2 1, 0 0))\'), ST_Point("lng", "lat")))'
  );
  expect(clauseArea(['lng', 'lat'], 'POINT(1 2)', { source })).toMatchObject({ value: null, predicate: null });
  expect(clauseArea(['lng', 'lat'], null, { source }).value).toBeNull();
});

it('takes a Selection’s area clause out with an empty one from the same source', async () => {
  const selection = await sharedSelection('brush', new AbortController().signal);
  const source = {};
  selection.update(clauseArea(['lng', 'lat'], 'POLYGON((0 0, 2 0, 2 1, 0 0))', { source }));
  expect(selection.clauses).toHaveLength(1);
  selection.update(clauseArea(['lng', 'lat'], null, { source }));
  expect(selection.clauses).toHaveLength(0);
});
