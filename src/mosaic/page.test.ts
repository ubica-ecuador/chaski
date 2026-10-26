import { Selection, clauseInterval, type MosaicClient } from '@uwdata/mosaic-core';

import type { ChangeEvent, ChaskiEngineApi } from '../grafana/publicApi';
import { dashboardKey, isHolder, pageFor, releaseClauses, resetPages } from './page';

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
  const source = { reset: jest.fn() };
  brush.update(clauseInterval('mag', [1, 2], { source }));
  const values: unknown[] = [];
  brush.addEventListener('value', () => {
    values.push(brush.clauses.map((c) => c.value));
  });
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
  // The brush's clause went; its range stays, held by no panel, and never left the Selection.
  expect(source.reset).toHaveBeenCalled();
  expect(brush.clauses).toHaveLength(1);
  expect(isHolder(brush.clauses[0].source)).toBe(true);
  expect(brush.clauses[0].value).toEqual([1, 2]);
  expect(values.every((v) => JSON.stringify(v).includes('[1,2]'))).toBe(true);
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
  expect(brush.clauses[0].source).toBe(timeBrush);
  expect(timeBrush.reset).not.toHaveBeenCalled();
  expect(ownBrush.reset).toHaveBeenCalled();
  expect(isHolder(brush.clauses[1].source)).toBe(true);
  jest.useRealTimers();
});

it('keeps another plugin’s clause as a panel goes away, forgetting the clients it was widened to', async () => {
  const { mosaicRuntime } = await import('./runtime');
  const { e } = engine();
  const page = pageFor('a', e);
  const brush = Selection.crossfilter();
  page.params.set('brush', brush);
  const mine = {} as MosaicClient;
  const theirs = {} as MosaicClient;
  const timeBrush = { reset: jest.fn() };
  const clause = mosaicRuntime.clauseInterval('t', [new Date(1), new Date(2)], { source: timeBrush });
  // A filters panel's linked brushes widened it to their marks.
  clause.clients = new Set([mine, theirs]);
  brush.update(clause);

  releaseClauses(page, [mine]);
  expect(brush.clauses.map((c) => c.source)).toEqual([timeBrush]);
  expect([...brush.clauses[0].clients!]).toEqual([theirs]);
  expect(timeBrush.reset).not.toHaveBeenCalled();
});

it('keeps a range held through a reload as the old panel goes away', async () => {
  jest.useFakeTimers();
  const { e, emit, loaded } = engine();
  const page = pageFor('a', e);
  const brush = Selection.crossfilter();
  page.params.set('brush', brush);
  const oldMark = {} as MosaicClient;
  brush.update(clauseInterval('t', [1, 2], { source: {}, clients: new Set([oldMark]) }));
  loaded.set('traffic', 1);
  page.read(['traffic'], e.datasets());
  emit('traffic', 2);
  await jest.advanceTimersByTimeAsync(100);
  jest.useRealTimers();
  // The old panel's linked brushes widen every clause on their column, the held one too.
  brush.clauses[0].clients = new Set([oldMark]);

  releaseClauses(page, [oldMark]);
  expect(brush.clauses).toHaveLength(1);
  expect(isHolder(brush.clauses[0].source)).toBe(true);
  expect(brush.clauses[0].clients?.size).toBe(0);
});

it('holds no range on a column another plugin’s clause holds through a reload', async () => {
  jest.useFakeTimers();
  const { mosaicRuntime } = await import('./runtime');
  const { e, emit, loaded } = engine();
  const page = pageFor('a', e);
  const brush = Selection.crossfilter();
  page.params.set('brush', brush);
  // The filters panel's brush still holds the old window as a Time Brush moves to a new one.
  brush.update(clauseInterval('t', [1, 2], { source: {} }));
  const timeBrush = { reset: jest.fn() };
  brush.update(mosaicRuntime.clauseInterval('t', [new Date(5), new Date(6)], { source: timeBrush }));
  loaded.set('traffic', 1);
  page.read(['traffic'], e.datasets());
  emit('traffic', 2);
  await jest.advanceTimersByTimeAsync(100);
  jest.useRealTimers();
  expect(brush.clauses.map((c) => c.source)).toEqual([timeBrush]);
});
