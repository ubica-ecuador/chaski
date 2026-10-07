import { BehaviorSubject } from 'rxjs';

import type { ChangeEvent, DatasetInfo } from '../grafana/publicApi';
import type { AssistantDigest } from './digest';
import { startAssistantContext, type LiveContextDeps } from './liveContext';

jest.mock('./pageContext', () => ({ registerAssistant: jest.fn() }));

/** A controller over fake engine deps; the returned handles drive it the way the engine and the URL would. */
function setup(initial: DatasetInfo[] = [], initialDashboard: string | undefined = 'abc') {
  let datasets = initial;
  let dashboard = initialDashboard;
  let range: ReturnType<LiveContextDeps['timeRange']>;
  let changeListener: (event: ChangeEvent) => void = () => undefined;
  let locationListener: () => void = () => undefined;
  const available = new BehaviorSubject(true);
  const registered: AssistantDigest[] = [];
  const unregister = jest.fn();
  const describe = jest.fn(async (table: string) => [{ name: `${table}_col`, type: 'INTEGER' }]);
  const reads = jest.fn();
  const deps: LiveContextDeps = {
    datasets: () => (reads(), datasets),
    onChange: (listener) => {
      changeListener = listener;
      return () => undefined;
    },
    describe,
    activeDashboard: () => dashboard,
    timeRange: () => range,
    onLocation: (listener) => {
      locationListener = listener;
      return () => undefined;
    },
    available,
    register: (digest) => {
      registered.push(digest);
      return unregister;
    },
  };
  const stop = startAssistantContext(deps);
  return {
    stop,
    available,
    registered,
    unregister,
    describe,
    reads,
    setDatasets: (next: DatasetInfo[]) => (datasets = next),
    setDashboard: (next: string) => (dashboard = next),
    setRange: (next: ReturnType<LiveContextDeps['timeRange']>) => (range = next),
    change: (event: ChangeEvent) => changeListener(event),
    navigate: () => locationListener(),
  };
}

const ds = (name: string, table = `t_${name}_1`): DatasetInfo => ({
  name,
  view: `datasets."${name}"`,
  table,
  rows: 1,
  loadedAt: 0,
});

it('registers what is already loaded as soon as the Assistant is there', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
  expect(t.registered[0].datasets[0].columns).toEqual([{ name: 't_a_1_col', type: 'INTEGER' }]);
});

it('describes the version it caches, not the view, which may still read the previous one', async () => {
  const t = setup([ds('a', 't_a_7')]);
  await t.stop.settled();
  expect(t.describe).toHaveBeenCalledWith('t_a_7');
});

it('registers nothing while the Assistant is unavailable, and unregisters when it goes', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.available.next(false);
  expect(t.unregister).toHaveBeenCalledTimes(1);
  t.change({ kind: 'dataset', name: 'a', view: 'datasets."a"' });
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
});

it('registers nothing with no datasets', async () => {
  const t = setup([], 'abc');
  await t.stop.settled();
  expect(t.registered).toHaveLength(0);
});

it('registers nothing outside a dashboard', async () => {
  const t = setup([ds('a')], 'no-dashboard');
  await t.stop.settled();
  expect(t.registered).toHaveLength(0);
});

it('coalesces a burst of loads into one registration', async () => {
  const t = setup([]);
  await t.stop.settled();
  t.reads.mockClear();
  const names = ['a', 'b', 'c', 'd', 'e'];
  t.setDatasets(names.map((name) => ds(name)));
  for (const name of names) {
    t.change({ kind: 'dataset', name, view: `datasets."${name}"` });
  }
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
  expect(t.registered[0].datasets).toHaveLength(5);
  // One rebuild for the first event, one more for the four that arrived during it.
  expect(t.reads).toHaveBeenCalledTimes(2);
});

it('describes a table once, and again only when a new version lands', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.navigate();
  await t.stop.settled();
  expect(t.describe).toHaveBeenCalledTimes(1);
  t.setDatasets([ds('a', 't_a_2')]);
  t.change({ kind: 'dataset', name: 'a', view: 'datasets."a"' });
  await t.stop.settled();
  expect(t.describe).toHaveBeenCalledTimes(2);
});

it('does not re-register an unchanged digest', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.navigate();
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
  expect(t.unregister).not.toHaveBeenCalled();
});

it('does not re-register when a relative range only resolves to a later now', async () => {
  const t = setup([ds('a')]);
  t.setRange({ from: '2026-10-07T06:00:00.000Z', to: '2026-10-07T12:00:00.000Z', raw: { from: 'now-6h', to: 'now' } });
  await t.stop.settled();
  t.setRange({ from: '2026-10-07T06:00:05.000Z', to: '2026-10-07T12:00:05.000Z', raw: { from: 'now-6h', to: 'now' } });
  t.navigate();
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
  expect(t.registered[0].timeRange?.raw).toEqual({ from: 'now-6h', to: 'now' });
});

it('re-registers when the range itself changes', async () => {
  const t = setup([ds('a')]);
  t.setRange({ from: '2026-10-07T06:00:00.000Z', to: '2026-10-07T12:00:00.000Z', raw: { from: 'now-6h', to: 'now' } });
  await t.stop.settled();
  t.setRange({ from: '2026-10-07T11:00:00.000Z', to: '2026-10-07T12:00:00.000Z', raw: { from: 'now-1h', to: 'now' } });
  t.navigate();
  await t.stop.settled();
  expect(t.registered).toHaveLength(2);
});

it('keeps a dataset whose DESCRIBE fails, without columns', async () => {
  const t = setup([]);
  await t.stop.settled();
  t.describe.mockRejectedValueOnce(new Error('gone'));
  t.setDatasets([ds('a')]);
  t.change({ kind: 'dataset', name: 'a', view: 'datasets."a"' });
  await t.stop.settled();
  expect(t.registered[0].datasets[0]).not.toHaveProperty('columns');
});

it('moves the registration to the next dashboard', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.setDashboard('xyz');
  t.setDatasets([ds('b')]);
  t.change({ kind: 'dashboard', dashboard: 'xyz' });
  await t.stop.settled();
  expect(t.unregister).toHaveBeenCalledTimes(1);
  expect(t.registered[1].dashboard).toBe('xyz');
});

it('unregisters on stop and ignores later events', async () => {
  const t = setup([ds('a')]);
  await t.stop.settled();
  t.stop();
  expect(t.unregister).toHaveBeenCalledTimes(1);
  t.change({ kind: 'dataset', name: 'a', view: 'datasets."a"' });
  await t.stop.settled();
  expect(t.registered).toHaveLength(1);
});
