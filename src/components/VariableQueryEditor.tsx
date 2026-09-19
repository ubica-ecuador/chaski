import React, { useState } from 'react';
import type { QueryEditorProps } from '@grafana/data';
import { Field, TextArea } from '@grafana/ui';

import type { DataSource } from '../datasource';
import { DEFAULT_VARIABLE_QUERY, type DuckOptions, type DuckQuery, type DuckVariableQuery } from '../types';

/** Phase 0: the variable query as JSON. Task 11 gives it a real form. */
export function VariableQueryEditor({
  query,
  onChange,
}: QueryEditorProps<DataSource, DuckQuery, DuckOptions, DuckVariableQuery>) {
  const [text, setText] = useState(() => JSON.stringify(query?.kind ? query : DEFAULT_VARIABLE_QUERY, null, 2));
  const [error, setError] = useState<string>();
  return (
    <Field
      label="Variable query (JSON)"
      description='{"kind": "dataset", "name": …, "source": {…}} or {"kind": "values", "sql": …}'
      invalid={Boolean(error)}
      error={error}
    >
      <TextArea
        aria-label="Variable query"
        rows={14}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => {
          try {
            onChange(JSON.parse(text) as DuckVariableQuery);
            setError(undefined);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </Field>
  );
}
