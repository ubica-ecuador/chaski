import { DataSourcePlugin } from '@grafana/data';

import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { DataSource } from './datasource';
import type { DuckOptions, DuckQuery, DuckSecureOptions } from './types';

export const plugin = new DataSourcePlugin<DataSource, DuckQuery, DuckOptions, DuckSecureOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
