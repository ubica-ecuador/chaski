/** @jest-environment node */
import { missingExtension } from './extensions';

describe('missingExtension', () => {
  it('names a shipped extension DuckDB says is missing', () => {
    // The exact text captured from a real browser (Task 8's smoke test) for a
    // bare ST_AsWKB call before spatial had ever been loaded.
    expect(
      missingExtension(
        'Catalog Error: Scalar Function with name "st_aswkb" is not in the catalog, but it exists in the spatial extension.'
      )
    ).toBe('spatial');
  });

  it('ignores an extension this plugin does not ship', () => {
    expect(
      missingExtension(
        'Catalog Error: Scalar Function with name "h3_cell_to_lat" is not in the catalog, but it exists in the h3 extension.'
      )
    ).toBeUndefined();
  });

  it('ignores an ordinary missing-table Catalog Error', () => {
    expect(missingExtension('Catalog Error: Table with name d1_v_v3 does not exist!\nDid you mean…')).toBeUndefined();
  });
});
