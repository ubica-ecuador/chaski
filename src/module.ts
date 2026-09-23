import { DataSourcePlugin } from '@grafana/data';

import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { DataSource } from './datasource';
import { installChaskiGlobal } from './grafana/publicApi';
import type { DuckOptions, DuckQuery, DuckSecureOptions } from './types';

// Other plugins (the explorer, the kepler map) find the engine here at runtime.
installChaskiGlobal();

export const plugin = new DataSourcePlugin<DataSource, DuckQuery, DuckOptions, DuckSecureOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
