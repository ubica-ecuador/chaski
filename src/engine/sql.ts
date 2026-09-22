/** Quotes a DuckDB identifier (a table or column name). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quotes a DuckDB string literal. */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface QuotedSpan {
  quote: "'" | '"';
  /** Index of the opening quote. */
  start: number;
  /** Index just past the closing quote; the end of `sql` when the quote is never closed. */
  end: number;
}

/**
 * The single-quoted string literals ('…', with '' as the escaped quote) and
 * double-quoted identifiers ("…", with "" as the escaped quote) in `sql`, in
 * order. A doubled quote is one escaped character and does not end its span.
 * Comments, E'…' and $$…$$ strings are not recognised.
 */
export function quotedSpans(sql: string): QuotedSpan[] {
  const spans: QuotedSpan[] = [];
  let i = 0;
  while (i < sql.length) {
    const quote = sql[i];
    if (quote !== "'" && quote !== '"') {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] !== quote) {
        j++;
      } else if (sql[j + 1] === quote) {
        j += 2;
      } else {
        j++;
        break;
      }
    }
    spans.push({ quote, start: i, end: Math.min(j, sql.length) });
    i = j;
  }
  return spans;
}

/**
 * `sql` with every single-quoted string literal replaced by `?`. Variables are
 * interpolated as quoted literals (`$x` → `'value'`), so this keeps a
 * statement's shape whatever values it was given, while identifiers (dataset
 * tables), numbers and raw values stay as they are.
 */
export function maskStringLiterals(sql: string): string {
  let masked = '';
  let last = 0;
  for (const span of quotedSpans(sql)) {
    if (span.quote === "'") {
      masked += `${sql.slice(last, span.start)}?`;
      last = span.end;
    }
  }
  return masked + sql.slice(last);
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
