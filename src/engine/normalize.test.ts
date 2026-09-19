/** @jest-environment node */
import { normalizingReplace } from './normalize';

describe('normalizingReplace', () => {
  it('casts what a DataFrame cannot carry', () => {
    expect(
      normalizingReplace([
        { name: 'geom', type: 'GEOMETRY' },
        { name: 'h', type: 'HUGEINT' },
        { name: 'd', type: 'DECIMAL(10,2)' },
        { name: 'iv', type: 'INTERVAL' },
        { name: 'tm', type: 'TIME' },
        { name: 'u', type: 'UUID' },
        { name: 'ok', type: 'VARCHAR' },
        { name: 'ts', type: 'TIMESTAMP WITH TIME ZONE' },
      ])
    ).toBe(
      'ST_AsWKB("geom") AS "geom", CAST("h" AS DOUBLE) AS "h", CAST("d" AS DOUBLE) AS "d", ' +
        'CAST("iv" AS VARCHAR) AS "iv", CAST("tm" AS VARCHAR) AS "tm", CAST("u" AS VARCHAR) AS "u"'
    );
  });

  it('returns undefined when every column already fits', () => {
    expect(normalizingReplace([{ name: 'a', type: 'BIGINT' }, { name: 'b', type: 'DATE' }])).toBeUndefined();
  });
});
