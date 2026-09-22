/** @jest-environment node */
import { maskStringLiterals, quoteIdent, quoteLiteral, sanitizeName, shortHash, stripTrailingSemicolons } from './sql';

describe('sql helpers', () => {
  it('quotes identifiers, doubling embedded quotes', () => {
    expect(quoteIdent('d1_vehicles_v2')).toBe('"d1_vehicles_v2"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  it('quotes literals, doubling embedded quotes', () => {
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it('drops trailing semicolons and whitespace only', () => {
    expect(stripTrailingSemicolons('SELECT 1; \n ;')).toBe('SELECT 1');
    expect(stripTrailingSemicolons("SELECT ';'")).toBe("SELECT ';'");
  });

  it('hashes with FNV-1a to 8 hex characters', () => {
    expect(shortHash('abc')).toBe('1a47e90b');
    expect(shortHash('abd')).not.toBe(shortHash('abc'));
  });

  it('keeps only identifier characters in dataset names', () => {
    expect(sanitizeName('my-set.v2')).toBe('my_set_v2');
    expect(sanitizeName('')).toBe('dataset');
    expect(sanitizeName('x'.repeat(60))).toHaveLength(40);
  });

  it('masks single-quoted literals, so a statement keeps its shape whatever values were interpolated', () => {
    const a = "SELECT n FROM \"d1_t_v2\" WHERE t BETWEEN '2026-09-01T00:00:00Z' AND 'O''Brien' AND k = 3";
    const b = "SELECT n FROM \"d1_t_v2\" WHERE t BETWEEN '2026-09-02T12:00:00Z' AND '' AND k = 3";
    expect(maskStringLiterals(a)).toBe('SELECT n FROM "d1_t_v2" WHERE t BETWEEN ? AND ? AND k = 3');
    expect(maskStringLiterals(b)).toBe(maskStringLiterals(a));
  });

  it('keeps identifiers, numbers and raw values in the mask', () => {
    expect(maskStringLiterals('SELECT "it\'s" FROM "d1_t_v3" LIMIT 10')).toBe('SELECT "it\'s" FROM "d1_t_v3" LIMIT 10');
    expect(maskStringLiterals("SELECT * FROM t WHERE c IN ('a','b')")).toBe('SELECT * FROM t WHERE c IN (?,?)');
    expect(maskStringLiterals("SELECT 'open")).toBe('SELECT ?');
  });
});
