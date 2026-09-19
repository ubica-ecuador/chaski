import React from 'react';
import type { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { Field, Input } from '@grafana/ui';

import { DEFAULT_MEMORY_LIMIT_MB, type DuckOptions } from '../types';

export function ConfigEditor({ options, onOptionsChange }: DataSourcePluginOptionsEditorProps<DuckOptions>) {
  return (
    <Field
      label="Memory limit (MB)"
      description="How much memory DuckDB may use in each viewer's browser. Aggregate larger datasets on the server first."
    >
      <Input
        type="number"
        min={64}
        width={20}
        aria-label="Memory limit (MB)"
        value={options.jsonData.memoryLimitMB ?? DEFAULT_MEMORY_LIMIT_MB}
        onChange={(e) =>
          onOptionsChange({ ...options, jsonData: { ...options.jsonData, memoryLimitMB: Number(e.currentTarget.value) } })
        }
      />
    </Field>
  );
}
