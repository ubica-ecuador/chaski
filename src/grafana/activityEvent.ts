import { BusEventWithPayload } from '@grafana/data';

import type { Activity } from '../engine/activity';

/**
 * The engine's activity on Grafana's bus, between Chaski's own plugins: the
 * datasource publishes it, the Filters panel and the kepler link
 * (`src/kepler/link.ts`) listen. Kepler panels no longer hear it on the bus;
 * the link hands it to them. Apart from activity.ts so that the app's module
 * can listen without starting a counter of its own.
 */
export class DuckdbWasmActivityEvent extends BusEventWithPayload<Activity> {
  static type = 'ubica-duckdbwasm-activity';
}
