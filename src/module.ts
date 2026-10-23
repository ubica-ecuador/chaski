import { AppPlugin } from '@grafana/data';

/*
 * The app is the package: it brings the Chaski datasource and the Mosaic
 * panel (src/plugins/), each a plugin of its own id. It has no pages yet.
 */
export const plugin = new AppPlugin<{}>();
