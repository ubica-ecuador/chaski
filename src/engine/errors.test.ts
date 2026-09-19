/** @jest-environment node */
import { EngineStartError, explainError } from './errors';

describe('explainError', () => {
  it('names the missing table and the likely cause', () => {
    const e = explainError(new Error('Catalog Error: Table with name mytable does not exist!\nDid you mean…'));
    expect(e.kind).toBe('missing-table');
    expect(e.message).toContain('Table mytable does not exist. Is a dataset variable missing');
  });

  it('tells the person to reload when the missing table is one of this plugin’s own datasets', () => {
    const e = explainError(new Error('Catalog Error: Table with name d1a2b3c4d_vehicles_v3 does not exist!\nDid you mean…'));
    expect(e.kind).toBe('missing-table');
    expect(e.message).toBe(
      "The data behind this panel (d1a2b3c4d_vehicles_v3) was released from memory. Reload the page to load the dashboard's datasets again."
    );
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

  // The exact text captured from a real browser (scripts/smoke.cjs, check 3c):
  // read_json() against a URL that sends no CORS header at all.
  it('recognizes the real browser CORS failure text', () => {
    const real =
      "Invalid Error: NetworkError: Failed to execute 'send' on 'XMLHttpRequest': " +
      "Failed to load 'https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json'.\n\n" +
      'LINE 1: SELECT count(*) FROM read_json(\'https://cdn.mbta.com/realtime/VehiclePositions_e...\n' +
      '                             ^';
    expect(explainError(new Error(real)).kind).toBe('cors');
  });

  it('does not mistake a column merely named like "cors" for a CORS failure', () => {
    expect(explainError(new Error('Binder Error: Referenced column "cors_station_id" not found')).kind).toBe('sql');
  });

  it('does not mistake a bare mention of memory_limit_mb for an out-of-memory failure', () => {
    expect(explainError(new Error('Parser Error: syntax error at or near "memory_limit_mb"')).kind).toBe('sql');
  });
});
