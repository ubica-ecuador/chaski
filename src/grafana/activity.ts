import { getAppEvents } from '@grafana/runtime';

import { ActivityCounter } from '../engine/activity';
import { recordActivity } from '../engine/stats';
import { DuckdbWasmActivityEvent } from './activityEvent';

export { DuckdbWasmActivityEvent };

/** One per page, like the engine: every panel's work counts toward the same idle. */
export const activity = new ActivityCounter((payload) => {
  recordActivity({ state: payload.state, pending: payload.pending, at: Date.now() });
  getAppEvents().publish(new DuckdbWasmActivityEvent(payload));
});
