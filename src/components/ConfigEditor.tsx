import React from 'react';
import type { DataSourcePluginOptionsEditorProps } from '@grafana/data';
import { Button, Field, FieldSet, IconButton, Input, SecretInput, Stack, Switch } from '@grafana/ui';

import { DEFAULT_MEMORY_LIMIT_MB, type DuckOptions, type DuckSecureOptions } from '../types';

type Props = DataSourcePluginOptionsEditorProps<DuckOptions, DuckSecureOptions>;

const nameKey = (n: number) => `httpHeaderName${n}` as const;
const valueKey = (n: number) => `httpHeaderValue${n}` as const;

/**
 * Header rows: httpHeaderName1, 2, … up to the first missing one, which is
 * where Grafana's data proxy stops reading. Rows are only ever removed from
 * the end, so the numbering never has a gap and no secret has to move.
 */
export function headerCount(jsonData: DuckOptions): number {
  let n = 0;
  while (jsonData[nameKey(n + 1)] !== undefined) {
    n++;
  }
  return n;
}

/**
 * The first row before the last whose name is empty (trimmed). Grafana's data
 * proxy reads httpHeaderName1, 2, … and stops at the first empty name, so that
 * row and every one after it go unsent. The last row is exempt: a freshly
 * added row starts out empty and is just incomplete, not broken yet.
 */
function firstEmptyHeaderName(jsonData: DuckOptions, headers: number): number | undefined {
  for (let n = 1; n < headers; n++) {
    if ((jsonData[nameKey(n)] ?? '').trim() === '') {
      return n;
    }
  }
  return undefined;
}

/**
 * `Field` clones its `invalid`/`disabled`/`loading` props onto its single
 * child, and `Stack` forwards unrecognized props straight to its underlying
 * DOM element. Since `Field`'s child here is a `Stack` of header rows rather
 * than a form control that knows what to do with `invalid`, this wrapper
 * only takes `children` and quietly drops the rest, so React never sees them
 * land on the DOM.
 */
function HeaderRows({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction="column" gap={1}>
      {children}
    </Stack>
  );
}

export function ConfigEditor({ options, onOptionsChange }: Props) {
  const { jsonData } = options;
  const secureJsonData: DuckSecureOptions = options.secureJsonData ?? {};
  const secureJsonFields = options.secureJsonFields ?? {};
  const headers = headerCount(jsonData);
  const emptyHeaderName = firstEmptyHeaderName(jsonData, headers);

  const setJsonData = (patch: Partial<DuckOptions>) =>
    onOptionsChange({ ...options, jsonData: { ...jsonData, ...patch } });
  const setSecret = (key: string, value: string) =>
    onOptionsChange({ ...options, secureJsonData: { ...secureJsonData, [key]: value } as DuckSecureOptions });
  const resetSecret = (key: string) =>
    onOptionsChange({
      ...options,
      secureJsonFields: { ...secureJsonFields, [key]: false },
      secureJsonData: { ...secureJsonData, [key]: '' } as DuckSecureOptions,
    });
  const removeLastHeader = () => {
    const next = { ...jsonData };
    delete next[nameKey(headers)];
    onOptionsChange({
      ...options,
      jsonData: next,
      secureJsonFields: { ...secureJsonFields, [valueKey(headers)]: false },
      secureJsonData: { ...secureJsonData, [valueKey(headers)]: '' } as DuckSecureOptions,
    });
  };

  return (
    <>
      <Field
        label="Memory limit (MB)"
        description="How much memory DuckDB may use in each viewer's browser. Aggregate larger datasets on the server first."
      >
        <Input
          type="number"
          min={64}
          width={20}
          aria-label="Memory limit (MB)"
          value={jsonData.memoryLimitMB ?? DEFAULT_MEMORY_LIMIT_MB}
          onChange={(e) => setJsonData({ memoryLimitMB: Number(e.currentTarget.value) })}
        />
      </Field>

      <FieldSet label="Proxy for files without CORS or with credentials">
        <Field
          label="URL"
          description="The server $__proxy('path') reads from, through Grafana. Leave empty when every file this datasource reads is public and allows CORS."
        >
          <Input
            id="proxy-url"
            aria-label="URL"
            width={60}
            placeholder="https://data.example.com/files"
            value={options.url ?? ''}
            onChange={(e) => onOptionsChange({ ...options, url: e.currentTarget.value })}
          />
        </Field>

        <Field label="Basic auth">
          <Switch
            id="proxy-basic-auth"
            value={Boolean(options.basicAuth)}
            onChange={(e) => onOptionsChange({ ...options, basicAuth: e.currentTarget.checked })}
          />
        </Field>
        {options.basicAuth && (
          <>
            <Field label="User">
              <Input
                id="proxy-basic-user"
                width={40}
                value={options.basicAuthUser ?? ''}
                onChange={(e) => onOptionsChange({ ...options, basicAuthUser: e.currentTarget.value })}
              />
            </Field>
            <Field label="Password">
              <SecretInput
                id="proxy-basic-password"
                width={40}
                isConfigured={Boolean(secureJsonFields.basicAuthPassword)}
                value={secureJsonData.basicAuthPassword ?? ''}
                onChange={(e) => setSecret('basicAuthPassword', e.currentTarget.value)}
                onReset={() => resetSecret('basicAuthPassword')}
              />
            </Field>
          </>
        )}

        <Field
          label="Headers"
          description="Sent with every request, such as Authorization: Bearer … or X-API-Key. Values are stored encrypted."
          invalid={emptyHeaderName !== undefined || undefined}
          error={
            emptyHeaderName !== undefined
              ? `Header ${emptyHeaderName} has no name, so Grafana ignores it and every header after it. Name it, or remove the rows after it.`
              : undefined
          }
        >
          <HeaderRows>
            {Array.from({ length: headers }, (_, i) => i + 1).map((n) => (
              <Stack key={n} gap={1} alignItems="center">
                <Input
                  aria-label={`Header ${n} name`}
                  width={30}
                  placeholder="Authorization"
                  value={jsonData[nameKey(n)] ?? ''}
                  onChange={(e) => setJsonData({ [nameKey(n)]: e.currentTarget.value } as Partial<DuckOptions>)}
                />
                <SecretInput
                  aria-label={`Header ${n} value`}
                  width={40}
                  placeholder="Bearer …"
                  isConfigured={Boolean(secureJsonFields[valueKey(n)])}
                  value={secureJsonData[valueKey(n)] ?? ''}
                  onChange={(e) => setSecret(valueKey(n), e.currentTarget.value)}
                  onReset={() => resetSecret(valueKey(n))}
                />
                {n === headers && (
                  <IconButton name="trash-alt" tooltip="Remove this header" onClick={removeLastHeader} />
                )}
              </Stack>
            ))}
            <div>
              <Button
                variant="secondary"
                fill="outline"
                size="sm"
                icon="plus"
                onClick={() => setJsonData({ [nameKey(headers + 1)]: '' } as Partial<DuckOptions>)}
              >
                Add header
              </Button>
            </div>
          </HeaderRows>
        </Field>

        <Field
          label="API key parameter"
          description="Query-string parameter Grafana adds with the key, such as apikey. Leave empty when the server takes no key in the URL."
        >
          <Input
            id="proxy-key-param"
            aria-label="API key parameter"
            width={30}
            placeholder="apikey"
            value={jsonData.proxyKeyParam ?? ''}
            onChange={(e) => setJsonData({ proxyKeyParam: e.currentTarget.value })}
          />
        </Field>
        <Field label="API key">
          <SecretInput
            id="proxy-key-value"
            width={40}
            isConfigured={Boolean(secureJsonFields.proxyKeyValue)}
            value={secureJsonData.proxyKeyValue ?? ''}
            onChange={(e) => setSecret('proxyKeyValue', e.currentTarget.value)}
            onReset={() => resetSecret('proxyKeyValue')}
          />
        </Field>
      </FieldSet>
    </>
  );
}
