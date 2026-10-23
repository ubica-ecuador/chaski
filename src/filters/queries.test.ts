import type { Clause } from '../engine/crossfilter';
import { countSql, timeCondition, whereOf } from './queries';

const states: Clause[] = [
  { name: 'mag', label: 'Magnitude', sql: '"mag" >= 4', text: '≥ 4', variables: ['mag_lo', 'mag_hi'] },
  { name: 'kind', label: 'Kind', sql: undefined, text: '', variables: ['kinds'] },
  { name: 'place', label: 'Place', sql: `contains("place", 'chile')`, text: '“chile”', variables: ['q'] },
];

describe('whereOf', () => {
  it('ANDs the active filters, leaving out those named', () => {
    expect(whereOf(states)).toBe(`("mag" >= 4) AND (contains("place", 'chile'))`);
    expect(whereOf(states, ['mag'])).toBe(`(contains("place", 'chile'))`);
    expect(whereOf(states, ['mag', 'place'])).toBe('TRUE');
    expect(whereOf([], [], ['x > 1'])).toBe('x > 1');
  });
});

describe('timeCondition', () => {
  it('is nothing without a column, ISO bounds with one', () => {
    expect(timeCondition('', 0, 1)).toEqual([]);
    expect(timeCondition('time', 0, 86_400_000)).toEqual([
      `"time" >= '1970-01-01T00:00:00.000Z'`,
      `"time" < '1970-01-02T00:00:00.000Z'`,
    ]);
  });
});

describe('countSql', () => {
  it('counts the total, the rows shown, and the rows without each active filter', () => {
    const sql = countSql('t_1', states, [`"time" >= 'a'`]);
    expect(sql).toContain('count(*)::DOUBLE AS total');
    expect(sql).toContain(`count(*) FILTER (WHERE ("mag" >= 4) AND (contains("place", 'chile')))::DOUBLE AS shown`);
    expect(sql).toContain(`count(*) FILTER (WHERE (contains("place", 'chile')))::DOUBLE AS "without_mag"`);
    expect(sql).toContain(`AS "without_place"`);
    expect(sql).not.toContain('without_kind');
    expect(sql).toMatch(/FROM "t_1" WHERE "time" >= 'a'$/);
  });
});
