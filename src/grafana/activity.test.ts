import { BusEventWithPayload, EventBusSrv } from '@grafana/data';

import { stats } from '../engine/stats';
import { activity, DuckdbWasmActivityEvent } from './activity';

const mockBus = new EventBusSrv();
jest.mock('@grafana/runtime', () => ({ getAppEvents: () => mockBus }));

/** What the kepler panel declares on its side: another class with the same type string. */
class KeplerSideEvent extends BusEventWithPayload<{ state: string; at: number; pending: number }> {
  static type = 'ubica-duckdbwasm-activity';
}

describe('DuckdbWasmActivityEvent', () => {
  it('pins the event type the kepler panel listens for', () => {
    expect(DuckdbWasmActivityEvent.type).toBe('ubica-duckdbwasm-activity');
  });

  it('reaches a listener that declared its own copy of the event', async () => {
    const heard: unknown[] = [];
    const subscription = mockBus.subscribe(KeplerSideEvent, (event) => heard.push(event.payload));
    await activity.track(async () => undefined);
    subscription.unsubscribe();
    expect(heard).toEqual([
      { state: 'busy', at: expect.any(Number), pending: 1 },
      { state: 'settled', at: expect.any(Number), pending: 0 },
    ]);
  });

  it('records the transitions for the bench', async () => {
    stats.activity.length = 0;
    await activity.track(async () => undefined);
    expect(stats.activity.map((a) => a.state)).toEqual(['busy', 'settled']);
  });
});
