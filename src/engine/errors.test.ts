/** @jest-environment node */
import { EngineStartError, explainError } from './errors';

describe('explainError', () => {
  it('names the missing table and the likely cause', () => {
    const e = explainError(new Error('Catalog Error: Table with name d1_v_v3 does not exist!\nDid you mean…'));
    expect(e.kind).toBe('missing-table');
    expect(e.message).toContain('Table d1_v_v3 does not exist. Is a dataset variable missing');
  });

  it('points a CORS failure at the datasource source', () => {
    const e = explainError(new Error('IO Error: Could not read "https://x/y.parquet": NetworkError when attempting to fetch resource.'));
    expect(e.kind).toBe('cors');
    expect(e.message).toContain('Load it through a "datasource" source');
  });

  it('states the memory limit', () => {
    const e = explainError(new Error('Out of Memory Error: failed to allocate block'), 512);
    expect(e.kind).toBe('memory');
    expect(e.message).toContain('the 512 MB this datasource may use');
  });

  it('tells how to unblock an engine that did not start', () => {
    const e = explainError(new EngineStartError(new Error('Failed to construct Worker')));
    expect(e.kind).toBe('engine');
    expect(e.message).toContain("worker-src 'self'");
  });

  it('passes other SQL errors through', () => {
    expect(explainError(new Error('Parser Error: syntax error at or near "SELEC"'))).toEqual({
      kind: 'sql',
      message: 'Parser Error: syntax error at or near "SELEC"',
    });
  });
});
