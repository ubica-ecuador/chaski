import { Selection, clauseInterval, type MosaicClient } from '@uwdata/mosaic-core';

import type { ChangeEvent, ChaskiEngineApi } from '../grafana/publicApi';
import { dashboardKey, pageFor, releaseClauses, resetPages } from './page';

const dataset = (name: string, loadedAt: number) => ({
  name,
  view: `datasets."${name}"`,
  table: name,
  rows: 1,
  loadedAt,
});

const engine = () => {
  const listeners: Array<(event: ChangeEvent) => void> = [];
  const loaded = new Map<string, number>();
  const e: ChaskiEngineApi = {
    duckdbVersion: 'v1.4.3',
    queryIPC: jest.fn(),
    exec: jest.fn(async () => {}),
    datasets: () => [...loaded].map(([name, at]) => dataset(name, at)),
    onChange: (listener) => {
      listeners.push(listener);
      return () => {};
    },
    releaseScratch: async () => {},
  };
  const emit = (name: string, loadedAt: number) => {
    loaded.set(name, loadedAt);
    listeners.forEach((l) => l({ kind: 'dataset', name, view: `datasets."${name}"` }));
  };
  return { e, emit, loaded };
};

beforeEach(() => resetPages());

it('keys a page by the dashboard uid', () => {
  expect(dashboardKey('/d/earthquakes/earthquakes-the-last-30-days')).toBe('earthquakes');
  expect(dashboardKey('/grafana/d/abc')).toBe('abc');
});

it('shares params within a dashboard, not across', () => {
  const { e } = engine();
  const a = pageFor('a', e);
  expect(pageFor('a', e)).toBe(a);
  const b = pageFor('b', e);
  expect(b).not.toBe(a);
  expect(e.exec).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS mosaic CASCADE');
});

it('rebuilds once when datasets the panels read reload: pre-aggregates dropped, brushes cleared', async () => {
  jest.useFakeTimers();
  const { e, emit, loaded } = engine();
  const page = pageFor('a', e);
  const brush = Selection.crossfilter();
  page.params.set('brush', brush);
  brush.update(clauseInterval('mag', [1, 2], { source: {} }));
  const rebuilt = jest.fn();
  page.subscribe(rebuilt);
  loaded.set('quakes', 1).set('places', 1);
  page.read(['quakes', 'places'], e.datasets());

  // The view of the version already read, and a dataset no panel reads: nothing to do.
  emit('quakes', 1);
  emit('other', 5);
  await jest.advanceTimersByTimeAsync(100);
  expect(rebuilt).not.toHaveBeenCalled();

  emit('quakes', 2);
  emit('places', 2);
  await jest.advanceTimersByTimeAsync(100);

  expect(rebuilt).toHaveBeenCalledTimes(1);
  expect(page.generation).toBe(1);
  expect(brush.clauses).toHaveLength(0);
  expect(e.exec).toHaveBeenCalledWith('DROP SCHEMA IF EXISTS mosaic CASCADE');
  jest.useRealTimers();
});

it('releases only the clauses a panel’s clients made', () => {
  const { e } = engine();
  const page = pageFor('a', e);
  const brush = Selection.crossfilter();
  page.params.set('brush', brush);
  const mine = {} as MosaicClient;
  const theirs = {} as MosaicClient;
  brush.update(clauseInterval('mag', [1, 2], { source: {}, clients: new Set([mine]) }));
  brush.update(clauseInterval('depth', [0, 10], { source: {}, clients: new Set([theirs]) }));

  releaseClauses(page, [mine]);
  expect(brush.clauses).toHaveLength(1);
  expect(brush.clauses[0].clients?.has(theirs)).toBe(true);
});

it('keeps through a reload the clauses of other plugins’ panels, made with the runtime’s builders', async () => {
  jest.useFakeTimers();
  const { mosaicRuntime } = await import('./runtime');
  const { e, emit, loaded } = engine();
  const page = pageFor('a', e);
  const brush = Selection.crossfilter();
  page.params.set('brush', brush);
  // A Time Brush's window: its source's reset would open the window and write it.
  const timeBrush = { reset: jest.fn() };
  const ownBrush = { reset: jest.fn() };
  brush.update(mosaicRuntime.clauseInterval('t', [new Date(1), new Date(2)], { source: timeBrush }));
  brush.update(clauseInterval('jam', [10, 20], { source: ownBrush }));
  loaded.set('traffic', 1);
  page.read(['traffic'], e.datasets());

  emit('traffic', 2);
  await jest.advanceTimersByTimeAsync(100);

  expect(page.generation).toBe(1);
  expect(brush.clauses.map((c) => c.source)).toEqual([timeBrush]);
  expect(timeBrush.reset).not.toHaveBeenCalled();
  expect(ownBrush.reset).toHaveBeenCalled();
  jest.useRealTimers();
});
