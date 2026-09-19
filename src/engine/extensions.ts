/** The DuckDB extensions this plugin ships in its own dist/extensions/. */
export const SHIPPED_EXTENSIONS = ['spatial', 'json', 'parquet', 'httpfs'] as const;

// DuckDB's Catalog Error for a function that a known-but-unloaded extension
// defines, e.g.: `Catalog Error: Scalar Function with name "st_aswkb" is not
// in the catalog, but it exists in the spatial extension.`
const NOT_YET_LOADED = /is not in the catalog, but it exists in the (\S+) extension/;

/**
 * The extension DuckDB says a Catalog Error is missing, when that extension is
 * one this plugin ships (so the caller knows it is safe to `LOAD` it and retry
 * the statement) — undefined for any other Catalog Error, including one
 * naming an extension this plugin does not carry in dist/extensions/.
 */
export function missingExtension(message: string): string | undefined {
  const name = NOT_YET_LOADED.exec(message)?.[1];
  return name && (SHIPPED_EXTENSIONS as readonly string[]).includes(name) ? name : undefined;
}
