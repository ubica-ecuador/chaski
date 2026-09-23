import { Table } from 'apache-arrow';

import { createBrowserRunner } from '../engine/browserRunner';
import { EngineStartError } from '../engine/errors';
import type { SqlRunner } from '../engine/types';
import { getEngine, setEngineForTests } from './engine';
import { type ChaskiGlobal, installChaskiGlobal } from './publicApi';

jest.mock('@grafana/runtime', () => ({
  locationService: {
    getLocation: () => ({ pathname: '/d/abc/title' }),
    getHistory: () => ({ listen: () => () => undefined }),
  },
}));
jest.mock('../engine/browserRunner', () => ({ createBrowserRunner: jest.fn() }));

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
