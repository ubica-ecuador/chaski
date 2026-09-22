import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DataSourceSettings } from '@grafana/data';

import type { DuckOptions, DuckSecureOptions } from '../types';
import { ConfigEditor, headerCount } from './ConfigEditor';

type Settings = DataSourceSettings<DuckOptions, DuckSecureOptions>;

const base = {
  id: 1,
  uid: 'x',
  name: 'DuckDB WASM',
  type: 'ubica-duckdbwasm-datasource',
  access: 'proxy',
  url: '',
  basicAuth: false,
  basicAuthUser: '',
  jsonData: { memoryLimitMB: 1024 },
  secureJsonFields: {},
} as unknown as Settings;

// Feeds onOptionsChange back into the editor, as Grafana does.
function Harness({ initial, spy }: { initial: Settings; spy: jest.Mock }) {
  const [options, setOptions] = useState(initial);
  return (
    <ConfigEditor
      options={options}
      onOptionsChange={(next) => {
        spy(next);
        setOptions(next);
      }}
    />
  );
}

const last = (spy: jest.Mock): Settings => spy.mock.calls[spy.mock.calls.length - 1][0];

describe('ConfigEditor', () => {
  it('stores the proxy URL in the datasource url', () => {
    const spy = jest.fn();
    render(<Harness initial={base} spy={spy} />);
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://data.example/files' } });
    expect(last(spy).url).toBe('https://data.example/files');
  });

  it('stores basic auth in the standard fields, with the password encrypted', () => {
    const spy = jest.fn();
    render(<Harness initial={base} spy={spy} />);
    fireEvent.click(screen.getByLabelText('Basic auth'));
    fireEvent.change(screen.getByLabelText('User'), { target: { value: 'ana' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 's3cret' } });
    const options = last(spy);
    expect(options.basicAuth).toBe(true);
    expect(options.basicAuthUser).toBe('ana');
    expect(options.secureJsonData?.basicAuthPassword).toBe('s3cret');
    expect(options.jsonData).not.toHaveProperty('basicAuthPassword');
  });

  it('adds header rows as httpHeaderNameN in jsonData and httpHeaderValueN encrypted', () => {
    const spy = jest.fn();
    render(<Harness initial={base} spy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add header' }));
    fireEvent.change(screen.getByLabelText('Header 1 name'), { target: { value: 'Authorization' } });
    fireEvent.change(screen.getByLabelText('Header 1 value'), { target: { value: 'Bearer t' } });
    fireEvent.change(screen.getByLabelText('Header 2 name'), { target: { value: 'X-Team' } });
    fireEvent.change(screen.getByLabelText('Header 2 value'), { target: { value: 'geo' } });
    const options = last(spy);
    expect(options.jsonData.httpHeaderName1).toBe('Authorization');
    expect(options.jsonData.httpHeaderName2).toBe('X-Team');
    expect(options.secureJsonData?.httpHeaderValue1).toBe('Bearer t');
    expect(options.secureJsonData?.httpHeaderValue2).toBe('geo');
  });

  it('removes only the last header row, and resets its secret', () => {
    const spy = jest.fn();
    const initial = {
      ...base,
      jsonData: { ...base.jsonData, httpHeaderName1: 'A', httpHeaderName2: 'B' },
      secureJsonFields: { httpHeaderValue1: true, httpHeaderValue2: true },
    } as Settings;
    render(<Harness initial={initial} spy={spy} />);
    const removes = screen.getAllByRole('button', { name: 'Remove this header' });
    expect(removes).toHaveLength(1);
    fireEvent.click(removes[0]);
    const options = last(spy);
    expect(options.jsonData.httpHeaderName1).toBe('A');
    expect(options.jsonData).not.toHaveProperty('httpHeaderName2');
    expect(options.secureJsonFields.httpHeaderValue2).toBe(false);
    expect(options.secureJsonData?.httpHeaderValue2).toBe('');
    expect(options.secureJsonFields.httpHeaderValue1).toBe(true);
  });

  it('stores the API key parameter in jsonData and the key encrypted', () => {
    const spy = jest.fn();
    render(<Harness initial={base} spy={spy} />);
    fireEvent.change(screen.getByLabelText('API key parameter'), { target: { value: 'apikey' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'k-123' } });
    const options = last(spy);
    expect(options.jsonData.proxyKeyParam).toBe('apikey');
    expect(options.secureJsonData?.proxyKeyValue).toBe('k-123');
  });

  it('shows a saved secret as configured, and resets it', () => {
    const spy = jest.fn();
    render(<Harness initial={{ ...base, secureJsonFields: { proxyKeyValue: true } } as Settings} spy={spy} />);
    expect(screen.getByLabelText('API key')).toHaveValue('configured');
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(last(spy).secureJsonFields.proxyKeyValue).toBe(false);
  });

  it('keeps the memory limit field', () => {
    const spy = jest.fn();
    render(<Harness initial={base} spy={spy} />);
    fireEvent.change(screen.getByLabelText('Memory limit (MB)'), { target: { value: '512' } });
    expect(last(spy).jsonData.memoryLimitMB).toBe(512);
  });
});

describe('headerCount', () => {
  it('counts header rows up to the first gap, where Grafana stops reading', () => {
    expect(headerCount({ httpHeaderName1: 'a', httpHeaderName2: '', httpHeaderName4: 'x' } as DuckOptions)).toBe(2);
    expect(headerCount({} as DuckOptions)).toBe(0);
  });
});
