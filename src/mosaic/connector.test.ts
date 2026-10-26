import type { ChaskiEngineApi } from '../grafana/publicApi';
import { ChaskiConnector, waitForEngine } from './connector';

const engine = (): ChaskiEngineApi => ({
  duckdbVersion: 'v1.4.3',
  queryIPC: jest.fn(async () => new Uint8Array([1, 2, 3])),
  exec: jest.fn(async () => {}),
  datasets: () => [],
  onChange: () => () => {},
  releaseScratch: async () => {},
});

describe('ChaskiConnector', () => {
  it('sends arrow queries to queryIPC and the rest to exec, with the signal', async () => {
    const e = engine();
    const connector = new ChaskiConnector(e);
    const signal = new AbortController().signal;
    await expect(connector.query({ type: 'arrow', sql: 'SELECT 1' }, { signal })).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    await connector.query({ type: 'exec', sql: 'CREATE SCHEMA mosaic' });
    expect(e.queryIPC).toHaveBeenCalledWith('SELECT 1', { signal });
    expect(e.exec).toHaveBeenCalledWith('CREATE SCHEMA mosaic', { signal: undefined });
  });

  it('reports each answer with when its query was sent, and not a failure', async () => {
    const e = engine();
    const onAnswer = jest.fn();
    const connector = new ChaskiConnector(e, { onAnswer });
    const before = performance.now();
    await connector.query({ type: 'arrow', sql: 'SELECT 1' });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer.mock.calls[0][0]).toBeGreaterThanOrEqual(before);

    (e.queryIPC as jest.Mock).mockRejectedValueOnce(new Error('Binder Error'));
    await expect(connector.query({ type: 'arrow', sql: 'SELECT nope' })).rejects.toThrow('Binder Error');
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});

describe('ChaskiConnector catalog conflicts', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const conflict = () => new Error('TransactionContext Error: Catalog write-write conflict on create with "mosaic"');

  it('runs an exec again when another connection created the same entry first', async () => {
    const e = engine();
    (e.exec as jest.Mock).mockRejectedValueOnce(conflict());
    const done = new ChaskiConnector(e).query({ type: 'exec', sql: 'CREATE TABLE IF NOT EXISTS mosaic.p AS SELECT 1' });
    await jest.advanceTimersByTimeAsync(50);
    await expect(done).resolves.toBeUndefined();
    expect(e.exec).toHaveBeenCalledTimes(2);
  });

  it('gives up after three retries, and never retries other errors', async () => {
    const e = engine();
    (e.exec as jest.Mock).mockRejectedValue(conflict());
    const done = new ChaskiConnector(e).query({ type: 'exec', sql: 'CREATE TABLE x AS SELECT 1' });
    const settled = expect(done).rejects.toThrow('write-write conflict');
    await jest.advanceTimersByTimeAsync(2000);
    await settled;
    expect(e.exec).toHaveBeenCalledTimes(4);

    (e.exec as jest.Mock).mockReset().mockRejectedValue(new Error('Binder Error'));
    await expect(new ChaskiConnector(e).query({ type: 'exec', sql: 'SELECT nope' })).rejects.toThrow('Binder Error');
    expect(e.exec).toHaveBeenCalledTimes(1);
  });
});

describe('waitForEngine', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for Chaski to start, past a failed start', async () => {
    const target: { __chaski?: { apiVersion: number; engine: () => Promise<ChaskiEngineApi> | undefined } } = {};
    const ready = engine();
    const found = waitForEngine(new AbortController().signal, target);

    await jest.advanceTimersByTimeAsync(500);
    target.__chaski = { apiVersion: 1, engine: () => Promise.reject(new Error('no wasm')) };
    await jest.advanceTimersByTimeAsync(250);
    target.__chaski = { apiVersion: 1, engine: () => Promise.resolve(ready) };
    await jest.advanceTimersByTimeAsync(250);
    await expect(found).resolves.toBe(ready);
  });

  it('stops when the panel goes away', async () => {
    const abort = new AbortController();
    const found = waitForEngine(abort.signal, {});
    abort.abort(new Error('gone'));
    await expect(found).rejects.toThrow('gone');
  });
});
