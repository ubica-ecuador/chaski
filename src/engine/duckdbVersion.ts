/**
 * The DuckDB inside @duckdb/duckdb-wasm 1.32.0. Extensions are built per DuckDB
 * version, and the plugin serves them from dist/extensions/<this>/wasm_eh/, so
 * bumping duckdb-wasm means bumping this too. A test compares it with
 * `SELECT version()` (Task 3).
 */
export const DUCKDB_VERSION = 'v1.4.3';
