import { EventBusSrv } from '@grafana/data';

import { DuckdbWasmActivityEvent } from '../grafana/activityEvent';
import { KEPLER_LINK_TARGETS, keplerLink, keplerLinkExtension } from './link';
import pluginJson from '../plugin.json';

const mockBus = new EventBusSrv();
jest.mock('@grafana/runtime', () => ({
  getAppEvents: () => mockBus,
  getPluginImportUtils: () => ({ importPanelPlugin: () => Promise.resolve({ mosaicRuntime: { marker: 1 } }) }),
}));

describe('the kepler link', () => {
  it('is version 1, added to every kepler panel plugin.json lists', () => {
    expect(keplerLinkExtension.fn()).toBe(keplerLink);
    expect(keplerLink.apiVersion).toBe(1);
    const declared = pluginJson.extensions.addedFunctions.find((f) => f.title === keplerLinkExtension.title);
    expect(declared?.targets).toEqual(KEPLER_LINK_TARGETS);
    expect(KEPLER_LINK_TARGETS).toContain('ubica-keplergl-panel/chaski/v1');
  });

  it("hands the engine's activity on until unsubscribed, and keeps a listener's failure to itself", () => {
    const heard: unknown[] = [];
    const stop = keplerLink.subscribeActivity((activity) => heard.push(activity));
    const failing = keplerLink.subscribeActivity(() => {
      throw new Error('listener');
    });
    mockBus.publish(new DuckdbWasmActivityEvent({ state: 'busy', at: 1, pending: 1 }));
    stop();
    failing();
    mockBus.publish(new DuckdbWasmActivityEvent({ state: 'settled', at: 2, pending: 0 }));
    expect(heard).toEqual([{ state: 'busy', at: 1, pending: 1 }]);
  });

  it("lends the Mosaic panel's runtime", async () => {
    await expect(keplerLink.mosaicRuntime()).resolves.toEqual({ marker: 1 });
  });
});
