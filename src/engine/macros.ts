/**
 * Grafana's SQL time macros, expanded the way the server DuckDB datasource
 * (motherduck-duckdb-datasource 0.4.5) does, so a query moves between the two
 * unchanged. That datasource uses grafana-plugin-sdk-go's sqlutil defaults and
 * overrides $__timeFrom/$__timeTo to take no arguments.
 *
 * $__timeGroup is the one deliberate difference: the SDK emits
 * `datepart(hour, col)` with an unquoted part, which DuckDB rejects, so here it
 * becomes a time_bucket. $__interval and $__interval_ms are not macros here:
 * Grafana's template service resolves them first, as on the server.
 */
export interface MacroContext {
  /** Start of the time range, epoch ms. */
  from: number;
  /** End of the time range, epoch ms. */
  to: number;
}

/** Go's time.RFC3339 in UTC: the milliseconds are truncated away. */
export function rfc3339(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const ARITY: Record<string, number> = { timeFilter: 1, timeFrom: 0, timeTo: 0, timeGroup: 2 };

const UNITS: Record<string, string> = {
  ms: 'milliseconds',
  s: 'seconds',
  m: 'minutes',
  h: 'hours',
  d: 'days',
  w: 'weeks',
  M: 'months',
  y: 'years',
};

/** '5m' → '5 minutes'; anything else (such as '1 day') passes through. Quotes are dropped. */
function toDuckInterval(raw: string): string {
  const bare = raw.trim().replace(/^'(.*)'$/, '$1');
  const match = /^(\d+)(ms|s|m|h|d|w|M|y)$/.exec(bare);
  return match ? `${match[1]} ${UNITS[match[2]]}` : bare;
}

function expand(name: string, args: string[], ctx: MacroContext): string {
  const expected = ARITY[name];
  if (args.length !== expected) {
    throw new Error(
      `$__${name} expects ${expected} argument${expected === 1 ? '' : 's'}, received ${args.length}`
    );
  }
  switch (name) {
    case 'timeFilter':
      return `${args[0]} >= '${rfc3339(ctx.from)}' AND ${args[0]} <= '${rfc3339(ctx.to)}'`;
    case 'timeFrom':
      return `'${rfc3339(ctx.from)}'`;
    case 'timeTo':
      return `'${rfc3339(ctx.to)}'`;
    default:
      return `time_bucket(INTERVAL '${toDuckInterval(args[1])}', ${args[0]})`;
  }
}

/**
 * Reads `(a, f(b, c))` starting at `start`. Commas inside nested parentheses
 * stay in their argument. No parenthesis means no arguments; `()` too.
 */
function parseArgs(sql: string, start: number): { args: string[]; length: number } {
  if (sql[start] !== '(') {
    return { args: [], length: 0 };
  }
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === '(') {
      depth++;
      if (depth === 1) {
        continue;
      }
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        args.push(current.trim());
        const empty = args.length === 1 && args[0] === '';
        return { args: empty ? [] : args, length: i - start + 1 };
      }
    } else if (ch === ',' && depth === 1) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  throw new Error('A macro is missing its closing parenthesis');
}

export function expandMacros(sql: string, ctx: MacroContext): string {
  const pattern = /\$__(timeFilter|timeFrom|timeTo|timeGroup)\b/g;
  let out = '';
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const afterName = match.index + match[0].length;
    const parsed = parseArgs(sql, afterName);
    out += sql.slice(last, match.index) + expand(match[1], parsed.args, ctx);
    last = afterName + parsed.length;
    pattern.lastIndex = last;
  }
  return out + sql.slice(last);
}
