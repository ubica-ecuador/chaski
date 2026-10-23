import { getPluginImportUtils } from '@grafana/runtime';

import type { MosaicRuntime } from '../mosaic/runtime';

/** The app's Mosaic panel, whose module carries the one copy of Mosaic the panels share. */
export const MOSAIC_PANEL = 'ubica-chaski-mosaic-panel';

let loading: Promise<MosaicRuntime> | undefined;

/** Mosaic, from the Mosaic panel's module: loaded once, again after a failure. */
export function loadMosaic(): Promise<MosaicRuntime> {
  loading ??= getPluginImportUtils()
    .importPanelPlugin(MOSAIC_PANEL)
    .then((plugin) => {
      const runtime = (plugin as unknown as { mosaicRuntime?: MosaicRuntime }).mosaicRuntime;
      if (!runtime) {
        throw new Error(`The ${MOSAIC_PANEL} plugin of this Grafana does not share Mosaic: update the Chaski app`);
      }
      return runtime;
    })
    .catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
  return loading;
}
