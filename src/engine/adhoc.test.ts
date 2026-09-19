/** @jest-environment node */
import { adHocWhere } from './adhoc';

describe('adHocWhere', () => {
  const columns = ['city', 'n'];

  it('ANDs the filters whose column exists and skips the rest', () => {
    expect(
      adHocWhere(
        [
          { key: 'city', operator: '=', value: 'Quito' },
          { key: 'missing', operator: '=', value: 'x' },
          { key: 'n', operator: '>', value: '3' },
        ],
        columns
      )
    ).toBe(`"city" = 'Quito' AND "n" > '3'`);
  });

  it('covers negation, regex and the multi-value operators', () => {
    expect(adHocWhere([{ key: 'city', operator: '!=', value: "O'x" }], columns)).toBe(`"city" IS DISTINCT FROM 'O''x'`);
    expect(adHocWhere([{ key: 'city', operator: '=~', value: '^Q' }], columns)).toBe(
      `regexp_matches(CAST("city" AS VARCHAR), '^Q')`
    );
    expect(adHocWhere([{ key: 'city', operator: '!~', value: '^Q' }], columns)).toBe(
      `NOT regexp_matches(CAST("city" AS VARCHAR), '^Q')`
    );
    expect(adHocWhere([{ key: 'city', operator: '=|', value: 'Quito', values: ['Quito', 'Cuenca'] }], columns)).toBe(
      `"city" IN ('Quito', 'Cuenca')`
    );
    expect(adHocWhere([{ key: 'city', operator: '!=|', value: 'Quito', values: ['Quito'] }], columns)).toBe(
      `"city" NOT IN ('Quito')`
    );
  });

  it('returns undefined when nothing applies, and ignores unknown operators', () => {
    expect(adHocWhere([], columns)).toBeUndefined();
    expect(adHocWhere([{ key: 'city', operator: '~~', value: 'x' }], columns)).toBeUndefined();
  });
});
