import { getAssistantExtensionConfig } from '@grafana/assistant';
import { AppPlugin } from '@grafana/data';

import { assistantManifest } from './assistant/manifest';

/*
 * The app is the package: it brings the Chaski datasource and the Mosaic
 * panel (src/plugins/), each a plugin of its own id. It has no pages; it
 * registers Chaski's skills with the Grafana Assistant, which loads this
 * module on demand where it runs and never elsewhere.
 */
export const plugin = new AppPlugin<{}>().addFunction(getAssistantExtensionConfig(assistantManifest));
