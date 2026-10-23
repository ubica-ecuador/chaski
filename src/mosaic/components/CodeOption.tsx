import React from 'react';
import type { StandardEditorProps } from '@grafana/data';
import { CodeEditor } from '@grafana/ui';

export interface CodeOptionSettings {
  height?: number;
}

/** A YAML (or JSON) option, saved when the editor loses focus or on Ctrl+S. */
export function CodeOption({ value, onChange, item }: StandardEditorProps<string, CodeOptionSettings>) {
  return (
    <CodeEditor
      language="yaml"
      value={value ?? ''}
      height={item.settings?.height ?? 320}
      showLineNumbers
      showMiniMap={false}
      onBlur={onChange}
      onSave={onChange}
    />
  );
}
