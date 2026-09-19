/** DuckDB-WASM could not start at all: its wasm, its worker, or its setup failed. */
export class EngineStartError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'EngineStartError';
  }
}

export type ErrorKind = 'engine' | 'cors' | 'memory' | 'missing-table' | 'sql';

export interface ExplainedError {
  kind: ErrorKind;
  message: string;
}

// A cross-origin read the browser blocks reaches DuckDB as a network failure
// with status 0 — in a real browser (scripts/smoke.cjs, check 3c), DuckDB-WASM's
// XHR-based HTTP client reports it as "NetworkError: Failed to execute 'send' on
// 'XMLHttpRequest'…". Word boundaries around CORS keep this from also matching
// an ordinary identifier that merely contains "cors", such as a column named
// cors_station_id.
const CORS = /NetworkError|Failed to fetch|\bCORS\b|HTTP (?:status )?0\b|status(?: code)? 0\b/i;
// Word boundaries keep "memory_limit" from matching inside an unrelated identifier
// like memory_limit_mb (e.g. quoted in a parser error), while still matching the
// setting name on its own, as DuckDB's out-of-memory message states it.
const MEMORY = /Out of Memory|could not allocate|failed to allocate|\bmemory_limit\b/i;
const MISSING = /Catalog Error: Table with name (\S+?) does not exist/;

/** Turns what DuckDB says into what the person looking at the panel can do about it. */
export function explainError(error: unknown, memoryLimitMB?: number): ExplainedError {
  const raw = error instanceof Error ? error.message : String(error);
  if (error instanceof EngineStartError) {
    return {
      kind: 'engine',
      message:
        `DuckDB could not start in the browser: ${raw}. If Grafana sends a Content Security Policy, ` +
        `it must allow WebAssembly ('wasm-unsafe-eval' or 'unsafe-eval' in script-src) ` +
        `and workers from the plugin's own path (worker-src 'self').`,
    };
  }
  const missing = MISSING.exec(raw);
  if (missing) {
    return {
      kind: 'missing-table',
      message: `Table ${missing[1]} does not exist. Is a dataset variable missing, or has it not loaded yet? (${raw.split('\n')[0]})`,
    };
  }
  if (MEMORY.test(raw)) {
    return {
      kind: 'memory',
      message: `The data does not fit in the ${memoryLimitMB ?? 'configured'} MB this datasource may use. Aggregate it on the server before it reaches the browser. (${raw})`,
    };
  }
  if (CORS.test(raw)) {
    return {
      kind: 'cors',
      message: `This URL does not allow reads from the browser (CORS). Load it through a "datasource" source instead, such as the server DuckDB datasource. (${raw})`,
    };
  }
  return { kind: 'sql', message: raw };
}
