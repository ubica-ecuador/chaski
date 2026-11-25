import type { PluginExtensionAddedFunctionConfig } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';

import type { Activity } from '../engine/activity';
import { loadMosaic } from '../filters/runtime';
import type { MosaicRuntime } from '../mosaic/runtime';
import { DuckdbWasmActivityEvent } from '../grafana/activityEvent';

/**
 * What Chaski lends the kepler map panels (the free Kepler Geospatial Maps,
 * Kepler Plus's map and its Time Brush), through Grafana's plugin extensions:
 * each panel names an extension point `<its id>/chaski/v1` and asks Grafana
 * for the functions added to it (`usePluginFunctions`). The panel calls the
 * function and gets this object, version 1.
 *
 * - `subscribeActivity`: the engine's busy and settled transitions, so a map
 *   writing variables while it plays waits for the panels that answer them.
 * - `mosaicRuntime`: Mosaic as Chaski's own panels share it, for a map in a
 *   Mosaic Selection.
 *
 * Changing the shape is a new version: `chaski/v2`, beside this one.
 */
export interface KeplerLink {
  apiVersion: 1;
  subscribeActivity(listener: (activity: Activity) => void): () => void;
  mosaicRuntime(): Promise<MosaicRuntime>;
}

/** The kepler panels' extension points; plugin.json lists the same, which Grafana reads to load this app. */
export const KEPLER_LINK_TARGETS = [
  'ubica-keplergl-panel/chaski/v1',
  'ubica-keplerplus-panel/chaski/v1',
  'ubica-timebrush-panel/chaski/v1',
];

export const keplerLink: KeplerLink = {
  apiVersion: 1,
  subscribeActivity(listener) {
    const subscription = getAppEvents().subscribe(DuckdbWasmActivityEvent, (event) => {
      try {
        listener(event.payload);
      } catch {
        // A listener's failure stays with it.
      }
    });
    return () => subscription.unsubscribe();
  },
  mosaicRuntime: () => loadMosaic(),
};

export const keplerLinkExtension: PluginExtensionAddedFunctionConfig<() => KeplerLink> = {
  title: 'kepler-link',
  description: "The engine's activity and Mosaic, for the kepler map panels.",
  targets: KEPLER_LINK_TARGETS,
  fn: () => keplerLink,
};
