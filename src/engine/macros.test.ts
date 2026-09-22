/** @jest-environment node */
import { expandMacros, rfc3339 } from './macros';

const ctx = { from: Date.UTC(2026, 8, 18, 0, 0, 0, 999), to: Date.UTC(2026, 8, 19, 12, 30, 0) };

describe('rfc3339', () => {
  it('prints UTC and truncates to the second, like Go time.RFC3339', () => {
    expect(rfc3339(ctx.from)).toBe('2026-09-18T00:00:00Z');
  });
});

describe('expandMacros', () => {
  it('expands $__timeFilter over a column', () => {
    expect(expandMacros('WHERE $__timeFilter(ts)', ctx)).toBe(
      "WHERE ts >= '2026-09-18T00:00:00Z' AND ts <= '2026-09-19T12:30:00Z'"
    );
  });

  it('keeps commas inside nested parentheses in one argument', () => {
    expect(expandMacros("$__timeFilter(date_trunc('hour', ts))", ctx)).toBe(
      "date_trunc('hour', ts) >= '2026-09-18T00:00:00Z' AND date_trunc('hour', ts) <= '2026-09-19T12:30:00Z'"
    );
  });

  it('keeps a comma inside a quoted literal in one argument', () => {
    expect(expandMacros("$__timeFilter(s || ',x')", ctx)).toBe(
      "s || ',x' >= '2026-09-18T00:00:00Z' AND s || ',x' <= '2026-09-19T12:30:00Z'"
    );
  });

  it('does not close an argument on a parenthesis inside a quoted literal', () => {
    expect(expandMacros("$__timeFilter(coalesce(ts, ')'))", ctx)).toBe(
      "coalesce(ts, ')') >= '2026-09-18T00:00:00Z' AND coalesce(ts, ')') <= '2026-09-19T12:30:00Z'"
    );
  });

  it('expands $__timeFrom() and $__timeTo() with no arguments, as the server datasource does', () => {
    expect(expandMacros('CAST($__timeFrom() AS TIMESTAMPTZ), $__timeTo()', ctx)).toBe(
      "CAST('2026-09-18T00:00:00Z' AS TIMESTAMPTZ), '2026-09-19T12:30:00Z'"
    );
    expect(expandMacros('SELECT $__timeFrom', ctx)).toBe("SELECT '2026-09-18T00:00:00Z'");
  });

  it('turns $__timeGroup into a time_bucket, accepting Grafana-style and quoted intervals', () => {
    expect(expandMacros('$__timeGroup(ts, 5m)', ctx)).toBe("time_bucket(INTERVAL '5 minutes', ts)");
    expect(expandMacros("$__timeGroup(ts, '1h')", ctx)).toBe("time_bucket(INTERVAL '1 hours', ts)");
    expect(expandMacros('$__timeGroup(ts, 1 day)', ctx)).toBe("time_bucket(INTERVAL '1 day', ts)");
  });

  it('leaves unknown and longer names alone', () => {
    expect(expandMacros('$__timeFilterX $__interval $x', ctx)).toBe('$__timeFilterX $__interval $x');
  });

  it('rejects a wrong argument count and a missing parenthesis', () => {
    expect(() => expandMacros('$__timeFilter()', ctx)).toThrow('$__timeFilter expects 1 argument, received 0');
    expect(() => expandMacros('$__timeFrom(ts)', ctx)).toThrow('$__timeFrom expects 0 arguments, received 1');
    expect(() => expandMacros('$__timeFilter(ts', ctx)).toThrow('missing its closing parenthesis');
  });

  describe('inside quoted SQL', () => {
    it('leaves a macro token alone inside a single-quoted string literal', () => {
      expect(expandMacros("SELECT '$__timeFilter(x)'", ctx)).toBe("SELECT '$__timeFilter(x)'");
    });

    it('leaves a macro token alone past a doubled (escaped) quote', () => {
      expect(expandMacros("SELECT 'O''Brien $__timeFrom()'", ctx)).toBe("SELECT 'O''Brien $__timeFrom()'");
    });

    it('leaves a macro token alone inside a double-quoted identifier', () => {
      expect(expandMacros('SELECT "$__timeFrom"', ctx)).toBe('SELECT "$__timeFrom"');
    });

    it('expands a macro outside quotes but leaves a later one inside quotes alone', () => {
      expect(expandMacros("WHERE $__timeFilter(ts) AND note = 'see $__timeTo()'", ctx)).toBe(
        "WHERE ts >= '2026-09-18T00:00:00Z' AND ts <= '2026-09-19T12:30:00Z' AND note = 'see $__timeTo()'"
      );
    });
  });
});
