/** @jest-environment node */
import { SingleFlight } from './singleFlight';

/** An execution the test settles by hand; `signal()` is the one SingleFlight started it with. */
function execution<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  let started: AbortSignal | undefined;
  const start = jest.fn((signal: AbortSignal) => {
    started = signal;
    return promise;
  });
  return { start, resolve, reject, signal: () => started! };
}

/** Where a promise stands once pending callbacks have run, without waiting for it to settle. */
async function state(promise: Promise<unknown>): Promise<'pending' | 'resolved' | 'rejected'> {
  let seen: 'pending' | 'resolved' | 'rejected' = 'pending';
  promise.then(
    () => (seen = 'resolved'),
    () => (seen = 'rejected')
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  return seen;
}

const live = () => new AbortController().signal;
const ABORTED = { name: 'AbortError' };

let flights: SingleFlight<string>;

beforeEach(() => {
  flights = new SingleFlight<string>();
});

describe('SingleFlight', () => {
  it('rejects a call whose signal has already aborted, neither starting nor joining an execution', async () => {
    const aborted = new AbortController();
    aborted.abort();
    const never = execution<string>();
    const refused = flights.run('k', never.start, aborted.signal);
    expect(await state(refused)).toBe('rejected');
    await expect(refused).rejects.toMatchObject(ABORTED);
    expect(never.start).not.toHaveBeenCalled();

    const running = execution<string>();
    const staying = new AbortController();
    const onJoin = jest.fn();
    const first = flights.run('k', running.start, staying.signal);
    const refusedJoin = flights.run('k', running.start, aborted.signal, onJoin);
    expect(await state(refusedJoin)).toBe('rejected');
    await expect(refusedJoin).rejects.toMatchObject(ABORTED);
    expect(onJoin).not.toHaveBeenCalled();
    // It was never counted in, so the one real caller leaving is the last to leave.
    staying.abort();
    expect(running.signal().aborted).toBe(true);
    running.resolve('late');
    await expect(first).rejects.toMatchObject(ABORTED);
  });

  it('gives every caller the execution’s rejection', async () => {
    const running = execution<string>();
    const first = flights.run('k', running.start, live());
    const second = flights.run('k', running.start, live());
    const boom = new Error('boom');
    running.reject(boom);
    await expect(first).rejects.toBe(boom);
    await expect(second).rejects.toBe(boom);
    expect(running.start).toHaveBeenCalledTimes(1);
  });

  it('rejects a caller that leaves early at once, and keeps running for the others', async () => {
    const running = execution<string>();
    const leaving = new AbortController();
    const early = flights.run('k', running.start, leaving.signal);
    const staying = flights.run('k', running.start, live());
    leaving.abort();
    expect(await state(early)).toBe('rejected');
    await expect(early).rejects.toMatchObject(ABORTED);
    expect(running.signal().aborted).toBe(false);
    running.resolve('answer');
    await expect(staying).resolves.toBe('answer');
  });

  it('aborts the execution when the last caller leaves, and rejects that caller only once it has settled', async () => {
    const running = execution<string>();
    const one = new AbortController();
    const two = new AbortController();
    const first = flights.run('k', running.start, one.signal);
    const last = flights.run('k', running.start, two.signal);
    one.abort();
    expect(await state(first)).toBe('rejected');
    expect(running.signal().aborted).toBe(false);
    two.abort();
    expect(running.signal().aborted).toBe(true);
    expect(await state(last)).toBe('pending');
    // Even an execution that finishes anyway gives nothing to callers that left.
    running.resolve('too late');
    await expect(last).rejects.toMatchObject(ABORTED);
    await expect(first).rejects.toMatchObject(ABORTED);
  });

  it('starts afresh for a call that comes after an abort', async () => {
    const aborted = execution<string>();
    const leaving = new AbortController();
    const abandoned = flights.run('k', aborted.start, leaving.signal);
    leaving.abort();

    const fresh = execution<string>();
    const late = flights.run('k', fresh.start, live());
    expect(fresh.start).toHaveBeenCalledTimes(1);
    expect(fresh.signal().aborted).toBe(false);

    // The aborted execution settles while the fresh one runs: a third call must still join the fresh one.
    aborted.resolve('stale');
    await expect(abandoned).rejects.toMatchObject(ABORTED);
    const unused = execution<string>();
    const third = flights.run('k', unused.start, live());
    expect(unused.start).not.toHaveBeenCalled();

    fresh.resolve('fresh');
    await expect(late).resolves.toBe('fresh');
    await expect(third).resolves.toBe('fresh');
  });

  it('calls onJoin only for a call that joins an execution in flight', async () => {
    const onJoin = jest.fn();
    const running = execution<string>();
    const first = flights.run('k', running.start, live(), onJoin);
    expect(onJoin).not.toHaveBeenCalled();
    const second = flights.run('k', running.start, live(), onJoin);
    expect(onJoin).toHaveBeenCalledTimes(1);
    const other = execution<string>();
    const elsewhere = flights.run('other', other.start, live(), onJoin);
    expect(onJoin).toHaveBeenCalledTimes(1);

    running.resolve('a');
    other.resolve('b');
    await expect(Promise.all([first, second, elsewhere])).resolves.toEqual(['a', 'a', 'b']);
    // Nothing is kept once an execution settles, so there is nothing left to join.
    const again = execution<string>();
    const later = flights.run('k', again.start, live(), onJoin);
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(again.start).toHaveBeenCalledTimes(1);
    again.resolve('c');
    await expect(later).resolves.toBe('c');
  });

  it('counts out a caller that leaves from within onJoin', async () => {
    const running = execution<string>();
    const staying = new AbortController();
    const first = flights.run('k', running.start, staying.signal);
    const leaving = new AbortController();
    const joiner = flights.run('k', running.start, leaving.signal, () => leaving.abort());
    expect(await state(joiner)).toBe('rejected');
    await expect(joiner).rejects.toMatchObject(ABORTED);
    staying.abort();
    expect(running.signal().aborted).toBe(true);
    running.resolve('too late');
    await expect(first).rejects.toMatchObject(ABORTED);
  });
});
