import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { DuckQuery, DuckVariableQuery } from '../types';
import { QueryEditor } from './QueryEditor';
import { VariableQueryEditor } from './VariableQueryEditor';

jest.mock('@grafana/ui', () => {
  const actual = jest.requireActual('@grafana/ui');
  return {
    ...actual,
    // Monaco does not run under jsdom; a textarea that commits on blur stands in.
    CodeEditor: ({ value, onBlur }: { value: string; onBlur?: (v: string) => void }) => (
      <textarea aria-label="code" defaultValue={value} onBlur={(e) => onBlur?.(e.currentTarget.value)} />
    ),
  };
});

const mockGet = jest.fn();
jest.mock('@grafana/runtime', () => ({
  getDataSourceSrv: () => ({ get: mockGet }),
  DataSourcePicker: ({ onChange }: { onChange: (ds: { uid: string; type: string }) => void }) => (
    <button onClick={() => onChange({ uid: 'duckdb', type: 'motherduck-duckdb-datasource' })}>pick source</button>
  ),
}));

// Feeds onChange back into the editor, as Grafana does.
function Harness({ initial, spy }: { initial: DuckVariableQuery; spy: jest.Mock }) {
  const [query, setQuery] = useState(initial);
  return (
    <VariableQueryEditor
      {...({} as any)}
      query={query}
      onChange={(q: DuckVariableQuery) => {
        spy(q);
        setQuery(q);
      }}
    />
  );
}

describe('QueryEditor', () => {
  it('commits the SQL on blur and runs it', () => {
    const onChange = jest.fn();
    const onRunQuery = jest.fn();
    render(
      <QueryEditor
        {...({} as any)}
        query={{ refId: 'A', rawSql: 'SELECT 1' } as DuckQuery}
        onChange={onChange}
        onRunQuery={onRunQuery}
      />
    );
    fireEvent.blur(screen.getByLabelText('code'), { target: { value: 'SELECT 2' } });
    expect(onChange).toHaveBeenCalledWith({ refId: 'A', rawSql: 'SELECT 2' });
    expect(onRunQuery).toHaveBeenCalled();
  });

  it('does not call onChange or onRunQuery when a blur commits unchanged text', () => {
    const onChange = jest.fn();
    const onRunQuery = jest.fn();
    render(
      <QueryEditor
        {...({} as any)}
        query={{ refId: 'A', rawSql: 'SELECT 1' } as DuckQuery}
        onChange={onChange}
        onRunQuery={onRunQuery}
      />
    );
    fireEvent.blur(screen.getByLabelText('code'), { target: { value: 'SELECT 1' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(onRunQuery).not.toHaveBeenCalled();
  });
});

describe('VariableQueryEditor', () => {
  const start: DuckVariableQuery = { refId: 'v', kind: 'dataset', name: '', source: { type: 'sql', sql: '' } };

  it('edits a dataset read with SQL in the browser', () => {
    const spy = jest.fn();
    render(<Harness initial={start} spy={spy} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'cities' } });
    fireEvent.blur(screen.getByLabelText('code'), { target: { value: "SELECT * FROM read_parquet('x')" } });
    expect(spy).toHaveBeenLastCalledWith({
      refId: 'v',
      kind: 'dataset',
      name: 'cities',
      source: { type: 'sql', sql: "SELECT * FROM read_parquet('x')" },
    });
  });

  it("embeds the source datasource's own query editor", async () => {
    const StubEditor = ({ query, onChange }: { query: object; onChange: (q: object) => void }) => (
      <button onClick={() => onChange({ ...query, rawSql: 'SELECT 42' })}>stub editor</button>
    );
    mockGet.mockResolvedValue({ name: 'Server DuckDB', components: { QueryEditor: StubEditor } });
    const spy = jest.fn();
    render(<Harness initial={{ ...start, name: 'lamp' }} spy={spy} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Another datasource' }));
    fireEvent.click(screen.getByText('pick source'));
    fireEvent.click(await screen.findByText('stub editor'));
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith({
        refId: 'v',
        kind: 'dataset',
        name: 'lamp',
        source: {
          type: 'datasource',
          datasource: { uid: 'duckdb', type: 'motherduck-duckdb-datasource' },
          query: { refId: 'dataset', rawSql: 'SELECT 42' },
        },
      })
    );
  });

  it('switches to a values variable', () => {
    const spy = jest.fn();
    render(<Harness initial={start} spy={spy} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Values' }));
    expect(spy).toHaveBeenLastCalledWith({ refId: 'v', kind: 'values', sql: '' });
  });
});
