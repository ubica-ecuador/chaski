import { databaseConfig } from './browserRunner';

describe('databaseConfig', () => {
  it('leaves DuckDB-WASM on whole-file reads by default', () => {
    expect(databaseConfig({})).toEqual({ query: { castBigIntToDouble: true } });
  });

  it('turns off forced full reads for range reads, and keeps the fallback for servers without ranges', () => {
    expect(databaseConfig({ rangeReads: true }).filesystem).toEqual({
      forceFullHTTPReads: false,
      allowFullHTTPReads: true,
    });
  });
});
