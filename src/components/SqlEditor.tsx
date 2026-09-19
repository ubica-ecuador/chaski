import React from 'react';
import { CodeEditor } from '@grafana/ui';

interface Props {
  label: string;
  value: string;
  onChange: (sql: string) => void;
  height?: number;
}

/**
 * Monaco with SQL highlighting. Commits on blur and on Ctrl/Cmd+S, never per keystroke, and only
 * when the committed text actually differs from `value`: a blur that leaves the text unchanged
 * (tabbing through without editing) must not fire `onChange` — for a dataset variable that would
 * re-run the variable and mint a new dataset table version for nothing.
 */
export function SqlEditor({ label, value, onChange, height = 160 }: Props) {
  const commit = (next: string) => {
    if (next !== value) {
      onChange(next);
    }
  };
  return (
    <div aria-label={label}>
      <CodeEditor
        language="sql"
        value={value}
        height={height}
        showLineNumbers
        showMiniMap={false}
        onBlur={commit}
        onSave={commit}
      />
    </div>
  );
}
