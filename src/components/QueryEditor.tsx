import React from 'react';
import type { QueryEditorProps } from '@grafana/data';
import { Field } from '@grafana/ui';

import type { DataSource } from '../datasource';
import type { DuckOptions, DuckQuery } from '../types';
import { SqlEditor } from './SqlEditor';

export function QueryEditor({ query, onChange, onRunQuery }: QueryEditorProps<DataSource, DuckQuery, DuckOptions>) {
  return (
    <Field
      label="SQL"
      description="Runs in the browser. Read a dataset with FROM $name; $__timeFilter(column) and the other macros work as in the server DuckDB datasource. $__proxy('path') reads a file through this datasource's proxy."
    >
      <SqlEditor
        label="SQL"
        value={query.rawSql ?? ''}
        onChange={(rawSql) => {
          onChange({ ...query, rawSql });
          onRunQuery();
        }}
      />
    </Field>
  );
}
