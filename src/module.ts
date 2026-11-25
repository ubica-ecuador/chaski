import { getAssistantExtensionConfig } from '@grafana/assistant';
import { AppPlugin } from '@grafana/data';

import { assistantManifest } from './assistant/manifest';
import { keplerLinkExtension } from './kepler/link';

/*
 * The app is the package: it brings the Chaski datasource and the Mosaic
 * panel (src/plugins/), each a plugin of its own id. It has no pages; it
 * registers Chaski's skills with the Grafana Assistant, and lends the kepler
 * map panels the engine's activity and Mosaic (src/kepler/link.ts). Grafana
 * loads this module on demand where one of those asks, and never elsewhere.
 */
export const plugin = new AppPlugin<{}>()
  .addFunction(getAssistantExtensionConfig(assistantManifest))
  .addFunction(keplerLinkExtension);
