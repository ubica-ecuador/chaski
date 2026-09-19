/** @jest-environment node */
import { quoteIdent, quoteLiteral, sanitizeName, shortHash, stripTrailingSemicolons } from './sql';

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
});
