/** Quotes a DuckDB identifier (a table or column name). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quotes a DuckDB string literal. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Drops trailing semicolons and whitespace, so a statement can be nested in another. */
export function stripTrailingSemicolons(sql: string): string {
  return sql.replace(/[\s;]+$/, '');
}

/** A short, stable hash (32-bit FNV-1a in hex) for table names. Not for security. */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Reduces a dataset name to what a bare table name can carry. */
export function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 40);
  return cleaned.length > 0 ? cleaned : 'dataset';
}
