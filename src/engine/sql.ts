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
 * `sql` without its comments: `--` to the end of the line and `/* … *\/`
 * (nested, as DuckDB reads them), each left as one space. String literals,
 * quoted identifiers and $$…$$ strings are kept as written, comment marks
 * inside them included. An unclosed block comment runs to the end.
 *
 * Grafana substitutes variables inside comments too, where quoting does not
 * protect them: a value with a newline ends a `--` comment, one with `*\/` a
 * block comment, and what follows would run as SQL.
 */
export function withoutComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      let j = i + 1;
      while (j < sql.length && (sql[j] !== quote || sql[j + 1] === quote)) {
        j += sql[j] === quote ? 2 : 1;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (two === '$$') {
      const close = sql.indexOf('$$', i + 2);
      const end = close === -1 ? sql.length : close + 2;
      out += sql.slice(i, end);
      i = end;
    } else if (two === '--') {
      const newline = sql.indexOf('\n', i);
      out += ' ';
      i = newline === -1 ? sql.length : newline;
    } else if (two === '/*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        const pair = sql.slice(i, i + 2);
        if (pair === '/*' || pair === '*/') {
          depth += pair === '/*' ? 1 : -1;
          i += 2;
        } else {
          i++;
        }
      }
      out += ' ';
    } else {
      out += sql[i];
      i++;
    }
  }
  return out;
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
