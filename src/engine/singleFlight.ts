interface Flight<T> {
  promise: Promise<T>;
  controller: AbortController;
  /** Calls still waiting for this execution. */
  callers: number;
}

/**
 * Lets identical calls that overlap share one execution. A call joins the
 * execution in flight under its key, or starts one.
 *
 * Every call has its own signal. Aborting it leaves the execution, which goes
 * on while any other call still waits for it and is aborted when the last one
 * leaves. An aborted execution is forgotten at once, so a call that comes
 * later starts afresh: no call ever gets an aborted execution's result.
 * Nothing is kept once an execution settles, whether it succeeded, failed or
 * was aborted.
 */
export class SingleFlight<T> {
  private readonly flights = new Map<string, Flight<T>>();

  /**
   * `start`'s result for `key`, from the execution already in flight when
   * there is one (then `onJoin` is called), or from a new one. A call whose
   * signal aborts rejects with an AbortError. When it was the last caller, it
   * rejects only once the aborted execution has settled, as the execution
   * would on its own: the work isn't over before then.
   */
  run(key: string, start: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, onJoin?: () => void): Promise<T> {
    if (signal.aborted) {
      return Promise.reject(abortError(signal));
    }
    const inFlight = this.flights.get(key);
    if (!inFlight) {
      return this.follow(key, this.start(key, start), signal);
    }
    inFlight.callers++;
    // Following first means the caller is counted out if onJoin makes it leave.
    const following = this.follow(key, inFlight, signal);
    onJoin?.();
    return following;
  }

  private start(key: string, start: (signal: AbortSignal) => Promise<T>): Flight<T> {
    const controller = new AbortController();
    const flight: Flight<T> = { promise: start(controller.signal), controller, callers: 1 };
    this.flights.set(key, flight);
    const forget = () => this.forget(key, flight);
    flight.promise.then(forget, forget);
    return flight;
  }

  private follow(key: string, flight: Flight<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let left = false;
      const leave = () => {
        left = true;
        flight.callers--;
        if (flight.callers > 0) {
          reject(abortError(signal));
          return;
        }
        this.forget(key, flight);
        flight.controller.abort();
        const rejectWhenSettled = () => reject(abortError(signal));
        flight.promise.then(rejectWhenSettled, rejectWhenSettled);
      };
      signal.addEventListener('abort', leave, { once: true });
      flight.promise.then(
        (value) => {
          signal.removeEventListener('abort', leave);
          if (!left) {
            resolve(value);
          }
        },
        (error: unknown) => {
          signal.removeEventListener('abort', leave);
          if (!left) {
            reject(error);
          }
        }
      );
    });
  }

  /** Drops `flight` unless a newer execution already took its key. */
  private forget(key: string, flight: Flight<T>): void {
    if (this.flights.get(key) === flight) {
      this.flights.delete(key);
    }
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
