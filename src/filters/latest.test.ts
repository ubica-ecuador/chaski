import { latestOnly } from './latest';

/** Work whose runs end when the test says so. */
function controlled() {
  const runs: Array<{ input: string; end: () => void; fail: () => void }> = [];
  const work = (input: string) =>
    new Promise<void>((resolve, reject) => {
      runs.push({ input, end: resolve, fail: () => reject(new Error('aborted')) });
    });
  return { runs, work };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('latestOnly', () => {
  it('runs one input at a time, and of those that came meanwhile only the last', async () => {
    const { runs, work } = controlled();
    const push = latestOnly(work, (s) => s);
    push('a');
    push('b');
    push('c');
    push('d');
    expect(runs.map((r) => r.input)).toEqual(['a']);
    runs[0].end();
    await settle();
    expect(runs.map((r) => r.input)).toEqual(['a', 'd']);
    runs[1].end();
    await settle();
    expect(runs).toHaveLength(2);
  });

  it('drops an input of the same key as the last run, but not after a failure', async () => {
    const { runs, work } = controlled();
    const push = latestOnly(work, (s) => s);
    push('a');
    runs[0].end();
    await settle();
    push('a');
    expect(runs).toHaveLength(1);
    push('b');
    runs[1].fail();
    await settle();
    push('b');
    expect(runs.map((r) => r.input)).toEqual(['a', 'b', 'b']);
  });

  it('drops a waiting input that came back to the key running', async () => {
    const { runs, work } = controlled();
    const push = latestOnly(work, (s) => s);
    push('a');
    push('b');
    push('a');
    runs[0].end();
    await settle();
    expect(runs.map((r) => r.input)).toEqual(['a']);
  });
});
