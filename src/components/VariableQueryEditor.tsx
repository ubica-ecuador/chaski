import React, { useEffect, useState } from 'react';
import { CoreApp, type DataSourceApi, type QueryEditorProps } from '@grafana/data';
import { DataSourcePicker, getDataSourceSrv } from '@grafana/runtime';
import type { DataQuery } from '@grafana/schema';
import { Alert, Field, Input, RadioButtonGroup, Stack, TextArea } from '@grafana/ui';

import type { DataSource } from '../datasource';
import {
  DEFAULT_VARIABLE_QUERY,
  type DatasetVariableQuery,
  type DatasourceSource,
  type DuckOptions,
  type DuckQuery,
  type DuckVariableQuery,
} from '../types';
import { SqlEditor } from './SqlEditor';

type Props = QueryEditorProps<DataSource, DuckQuery, DuckOptions, DuckVariableQuery>;

const KINDS = [
  { label: 'Dataset', value: 'dataset' as const, description: 'Loads rows once; panels read them with FROM $name.' },
  { label: 'Values', value: 'values' as const, description: 'An ordinary dropdown, from SQL in the browser.' },
];

const SOURCES = [
  { label: 'Another datasource', value: 'datasource' as const },
  { label: 'SQL in the browser', value: 'sql' as const },
];

export function VariableQueryEditor({ query, onChange }: Props) {
  const current: DuckVariableQuery = query?.kind ? query : DEFAULT_VARIABLE_QUERY;
  const refId = current.refId ?? 'variable';
  return (
    <Stack direction="column" gap={2}>
      <Field label="Kind">
        <RadioButtonGroup
          options={KINDS}
          value={current.kind}
          onChange={(kind) =>
            onChange(kind === 'dataset' ? { ...DEFAULT_VARIABLE_QUERY, refId } : { refId, kind: 'values', sql: '' })
          }
        />
      </Field>
      {current.kind === 'dataset' ? (
        <DatasetFields query={current} onChange={onChange} />
      ) : (
        <Field label="SQL" description="First column is the value; a second column, if any, is the text shown.">
          <SqlEditor label="Values SQL" value={current.sql ?? ''} onChange={(sql) => onChange({ ...current, sql })} />
        </Field>
      )}
    </Stack>
  );
}

function DatasetFields({ query, onChange }: { query: DatasetVariableQuery; onChange: (q: DuckVariableQuery) => void }) {
  const source = query.source;
  return (
    <>
      <Field label="Name" description="Give it the variable's own name, so panels read it as FROM $name.">
        <Input aria-label="Name" value={query.name} onChange={(e) => onChange({ ...query, name: e.currentTarget.value })} />
      </Field>
      <Field label="Rows come from">
        <RadioButtonGroup
          options={SOURCES}
          value={source.type}
          onChange={(type) =>
            onChange({
              ...query,
              source:
                type === 'sql'
                  ? { type: 'sql', sql: '' }
                  : { type: 'datasource', datasource: { uid: '', type: '' }, query: { refId: 'dataset' } },
            })
          }
        />
      </Field>
      {source.type === 'sql' ? (
        <Field label="SQL" description="Runs in the browser: read_parquet/read_csv/read_json on a URL that allows CORS, or SELECT from another dataset.">
          <SqlEditor label="Dataset SQL" value={source.sql} onChange={(sql) => onChange({ ...query, source: { type: 'sql', sql } })} />
        </Field>
      ) : (
        <>
          <Field label="Datasource" description="Its query runs on the server with the dashboard's time range and variables.">
            <DataSourcePicker
              current={source.datasource.uid || null}
              noDefault
              filter={(ds) => ds.type !== 'ubica-chaski-datasource'}
              onChange={(ds) =>
                onChange({
                  ...query,
                  source: { type: 'datasource', datasource: { uid: ds.uid, type: ds.type }, query: { refId: 'dataset' } },
                })
              }
            />
          </Field>
          {source.datasource.uid && (
            <SourceQueryEditor
              key={source.datasource.uid}
              source={source}
              onChange={(sourceQuery) => onChange({ ...query, source: { ...source, query: sourceQuery } })}
            />
          )}
        </>
      )}
    </>
  );
}

/** The chosen datasource's own query editor, so a dataset is written the way that datasource is always written. */
function SourceQueryEditor({ source, onChange }: { source: DatasourceSource; onChange: (q: DataQuery) => void }) {
  const [datasource, setDatasource] = useState<DataSourceApi>();
  const [error, setError] = useState<string>();
  const uid = source.datasource.uid;
  useEffect(() => {
    let cancelled = false;
    getDataSourceSrv()
      .get({ uid })
      .then(
        (ds) => !cancelled && setDatasource(ds),
        (e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e))
      );
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (error) {
    return (
      <Alert severity="error" title="Could not load that datasource">
        {error}
      </Alert>
    );
  }
  if (!datasource) {
    return null;
  }
  const Editor = datasource.components?.QueryEditor;
  if (!Editor) {
    return <JsonQuery value={source.query} onChange={onChange} />;
  }
  return (
    <Editor
      datasource={datasource}
      query={source.query}
      onChange={onChange}
      onRunQuery={() => undefined}
      app={CoreApp.Dashboard}
    />
  );
}

function JsonQuery({ value, onChange }: { value: DataQuery; onChange: (q: DataQuery) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string>();
  return (
    <Field label="Query (JSON)" description="This datasource has no query editor to embed." invalid={Boolean(error)} error={error}>
      <TextArea
        aria-label="Source query JSON"
        rows={8}
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={() => {
          try {
            onChange(JSON.parse(text) as DataQuery);
            setError(undefined);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      />
    </Field>
  );
}
