import { type Activity, ActivityCounter } from './activity';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setup() {
  const said: Activity[] = [];
  let clock = 0;
  const counter = new ActivityCounter(
    (a) => said.push(a),
    () => ++clock
  );
  return { said, counter };
}

describe('ActivityCounter', () => {
  it('announces busy on the first piece of work and settled when the last one ends', async () => {
    const { said, counter } = setup();
    const a = deferred<void>();
    const b = deferred<void>();
    const pa = counter.track(() => a.promise);
    const pb = counter.track(() => b.promise);
    expect(said.map((s) => s.state)).toEqual(['busy']);
    a.resolve();
    await pa;
    expect(said.map((s) => s.state)).toEqual(['busy']);
    b.resolve();
    await pb;
    expect(said).toEqual([
      { state: 'busy', at: 1, pending: 1 },
      { state: 'settled', at: 2, pending: 0 },
    ]);
  });

  it('settles when the work fails, and passes the failure on', async () => {
    const { said, counter } = setup();
    await expect(counter.track(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(said.map((s) => s.state)).toEqual(['busy', 'settled']);
  });

  it('settles when starting the work throws', async () => {
    const { said, counter } = setup();
    await expect(
      counter.track(() => {
        throw new Error('sync');
      })
    ).rejects.toThrow('sync');
    expect(said.map((s) => s.state)).toEqual(['busy', 'settled']);
  });

  it('starts a new busy after settling', async () => {
    const { said, counter } = setup();
    await counter.track(async () => undefined);
    await counter.track(async () => undefined);
    expect(said.map((s) => s.state)).toEqual(['busy', 'settled', 'busy', 'settled']);
  });

  it('keeps working when the listener throws', async () => {
    const counter = new ActivityCounter(() => {
      throw new Error('listener');
    });
    await expect(counter.track(async () => 42)).resolves.toBe(42);
  });
});
