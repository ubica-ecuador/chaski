import { Table } from 'apache-arrow';

import { createBrowserRunner } from '../engine/browserRunner';
import { EngineStartError } from '../engine/errors';
import type { SqlRunner } from '../engine/types';
import { startAssistantForEngine } from './assistant';
import { getEngine, setEngineForTests } from './engine';
import { type ChaskiGlobal, installChaskiGlobal } from './publicApi';

jest.mock('@grafana/runtime', () => ({
  config: {
    datasources: {
      files: { type: 'ubica-chaski-datasource', url: '/api/datasources/proxy/uid/files' },
      prom: { type: 'prometheus', url: '/api/datasources/proxy/uid/prom' },
    },
  },
  locationService: {
    getLocation: () => ({ pathname: '/d/abc/title' }),
    getHistory: () => ({ listen: () => () => undefined }),
  },
}));
jest.mock('../engine/browserRunner', () => ({ createBrowserRunner: jest.fn() }));
jest.mock('./assistant', () => ({ startAssistantForEngine: jest.fn() }));

(globalThis as { __webpack_public_path__?: string }).__webpack_public_path__ = '/public/plugins/chaski/';

const startRunner = createBrowserRunner as jest.Mock;
const fakeRunner = (): SqlRunner & { version: string } => ({
  version: 'v1.4.3',
  query: async () => new Table(),
  exec: async () => undefined,
  insertArrow: async () => undefined,
});

/** A browser runner start that the test settles by hand. */
function pendingStart() {
  let resolve!: (runner: SqlRunner & { version: string }) => void;
  let reject!: (error: unknown) => void;
  startRunner.mockReturnValueOnce(
    new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    })
  );
  return { resolve, reject };
}

const target: { __chaski?: ChaskiGlobal } = {};
installChaskiGlobal(target);

afterEach(() => setEngineForTests(undefined));

describe('the published engine API', () => {
  it('is a pending promise while the engine starts, and resolves with the API', async () => {
    const start = pendingStart();
    const engine = getEngine(512);
    const api = target.__chaski?.engine();
    expect(api).toBeInstanceOf(Promise);
    start.resolve(fakeRunner());
    await engine;
    await expect(api).resolves.toMatchObject({ duckdbVersion: 'v1.4.3' });
    expect(target.__chaski?.engine()).toBe(api);
  });

  it('rejects, and is undefined again, when the start fails', async () => {
    const start = pendingStart();
    const engine = getEngine(512);
    const api = target.__chaski?.engine();
    start.reject(new Error('no wasm'));
    await expect(engine).rejects.toBeInstanceOf(EngineStartError);
    await expect(api).rejects.toBeInstanceOf(EngineStartError);
    expect(target.__chaski?.engine()).toBeUndefined();
  });
});

describe('range reads', () => {
  it('are off unless the starting instance asks, and the engine says which it got', async () => {
    const start = pendingStart();
    const engine = getEngine(512, true);
    expect(startRunner).toHaveBeenLastCalledWith(expect.objectContaining({ memoryLimitMB: 512, rangeReads: true }));
    // On Grafana's origin, the worker may read Chaski's proxy routes and nothing else.
    expect(startRunner.mock.lastCall[0].proxies).toEqual([
      `${window.location.origin}/api/datasources/proxy/uid/files/_plain/`,
      `${window.location.origin}/api/datasources/proxy/uid/files/_key/`,
    ]);
    start.resolve(fakeRunner());
    await expect(engine).resolves.toMatchObject({ rangeReads: true });
    // The engine is per page: a later instance asking otherwise gets the running one.
    await expect(getEngine(512, false)).resolves.toMatchObject({ rangeReads: true });

    setEngineForTests(undefined);
    pendingStart().resolve(fakeRunner());
    await expect(getEngine(512)).resolves.toMatchObject({ rangeReads: false });
  });
});

describe('the Grafana Assistant', () => {
  it('hears about the datasets through the published API, once the engine starts', async () => {
    const start = pendingStart();
    const engine = getEngine(512);
    start.resolve(fakeRunner());
    const started = await engine;
    const api = await target.__chaski?.engine();
    expect(startAssistantForEngine).toHaveBeenCalledWith(api, started.registry);
  });

  it('cannot stop the engine from starting', async () => {
    (startAssistantForEngine as jest.Mock).mockImplementationOnce(() => {
      throw new Error('no assistant here');
    });
    const start = pendingStart();
    const engine = getEngine(512);
    start.resolve(fakeRunner());
    await expect(engine).resolves.toMatchObject({ version: 'v1.4.3' });
  });
});
