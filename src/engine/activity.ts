export interface Activity {
  state: 'busy' | 'settled';
  /** performance.now() when the transition happened. */
  at: number;
  /** Work in flight right after the transition: 1 on busy, 0 on settled. */
  pending: number;
}

/**
 * Counts the work the datasource has in flight and announces the two
 * transitions a listener can pace itself on: idle to busy, and back. Nothing in
 * between, so announcing costs nothing per query. A listener's failure never
 * reaches the work.
 */
export class ActivityCounter {
  private pending = 0;

  constructor(
    private readonly announce: (activity: Activity) => void,
    private readonly now: () => number = () => performance.now()
  ) {}

  /** Counts `work` while it runs; success, failure and cancellation all settle it. */
  track<T>(work: () => Promise<T>): Promise<T> {
    this.change(1);
    let promise: Promise<T>;
    try {
      promise = work();
    } catch (error) {
      this.change(-1);
      return Promise.reject(error);
    }
    return promise.finally(() => this.change(-1));
  }

  private change(delta: 1 | -1): void {
    const before = this.pending;
    this.pending = Math.max(0, before + delta);
    if (before === 0 && this.pending === 1) {
      this.say('busy');
    } else if (before > 0 && this.pending === 0) {
      this.say('settled');
    }
  }

  private say(state: Activity['state']): void {
    try {
      this.announce({ state, at: this.now(), pending: this.pending });
    } catch {
      // A listener's failure must never reach a query.
    }
  }
}
