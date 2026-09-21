import { BusEventWithPayload } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import { type Activity, ActivityCounter } from '../engine/activity';
import { recordActivity } from '../engine/stats';

/**
 * The contract with the kepler panel, which paces its playback on it. kepler
 * declares its own copy of this class: Grafana's event bus matches events by
 * their `type` string, so neither plugin imports the other. Changing the string
 * or the payload breaks that pairing; the test pins both.
 */
export class DuckdbWasmActivityEvent extends BusEventWithPayload<Activity> {
  static type = 'ubica-duckdbwasm-activity';
}

/** One per page, like the engine: every panel's work counts toward the same idle. */
export const activity = new ActivityCounter((payload) => {
  recordActivity({ state: payload.state, pending: payload.pending, at: Date.now() });
  getAppEvents().publish(new DuckdbWasmActivityEvent(payload));
});
