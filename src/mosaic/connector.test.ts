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
