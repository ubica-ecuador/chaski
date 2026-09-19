import React from 'react';
import type { QueryEditorProps } from '@grafana/data';
import { Field, TextArea } from '@grafana/ui';

import type { DataSource } from '../datasource';
import type { DuckOptions, DuckQuery } from '../types';

export function QueryEditor({ query, onChange, onRunQuery }: QueryEditorProps<DataSource, DuckQuery, DuckOptions>) {
  return (
    <Field label="SQL" description="Runs in the browser. Read a dataset with FROM $name.">
      <TextArea
        aria-label="SQL"
        rows={8}
        value={query.rawSql ?? ''}
        onChange={(e) => onChange({ ...query, rawSql: e.currentTarget.value })}
        onBlur={onRunQuery}
      />
    </Field>
  );
}
