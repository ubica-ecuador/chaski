import { dateTime } from '@grafana/data';

import { interpolateSql, sqlStringFormat } from './interpolate';
import { fakeTemplateSrv } from './testing/fakes';

const range = { from: dateTime(Date.UTC(2026, 8, 18)), to: dateTime(Date.UTC(2026, 8, 19)), raw: { from: 'now-1d', to: 'now' } };

describe('sqlStringFormat', () => {
  it("quotes every value, like Grafana's sqlstring format", () => {
    expect(sqlStringFormat("O'x")).toBe("'O''x'");
    expect(sqlStringFormat(['a', 'b'])).toBe("'a','b'");
    expect(sqlStringFormat(5)).toBe("'5'");
    expect(sqlStringFormat(undefined)).toBe('');
  });
});

describe('interpolateSql', () => {
  const templateSrv = fakeTemplateSrv({ vehicles: 'd1_vehicles_v2', mode: ['Bus', 'Subway'], file: 'a.parquet' });
  const isDatasetTable = (name: string) => name === 'd1_vehicles_v2';
  const options = { templateSrv, range, isDatasetTable };

  it('turns a dataset variable into an identifier and quotes the rest', () => {
    expect(interpolateSql('SELECT * FROM $vehicles WHERE mode IN ($mode)', options)).toBe(
      `SELECT * FROM "d1_vehicles_v2" WHERE mode IN ('Bus','Subway')`
    );
  });

  it('leaves ${x:raw} verbatim', () => {
    expect(interpolateSql("read_parquet('http://h/${file:raw}')", options)).toBe("read_parquet('http://h/a.parquet')");
  });

  it('expands macros after variables', () => {
    expect(interpolateSql('WHERE $__timeFilter(t) AND m IN (${mode})', options)).toBe(
      "WHERE t >= '2026-09-18T00:00:00Z' AND t <= '2026-09-19T00:00:00Z' AND m IN ('Bus','Subway')"
    );
  });

  it('does not expand a macro-looking token that came from a substituted variable value', () => {
    const injected = fakeTemplateSrv({ hack: '$__timeGroup(c, || 1 ||)' });
    const withHack = { templateSrv: injected, range, isDatasetTable };
    expect(interpolateSql('SELECT $hack', withHack)).toBe("SELECT '$__timeGroup(c, || 1 ||)'");
  });

  it('expands $__proxy with the base it is given, after quoting variables', () => {
    const proxyBase = 'https://g.example/api/datasources/proxy/uid/u/_plain';
    expect(interpolateSql("read_parquet($__proxy('zonas/' || $file))", { ...options, proxyBase })).toBe(
      "read_parquet(('https://g.example/api/datasources/proxy/uid/u/_plain/' || ('zonas/' || 'a.parquet')))"
    );
  });
});
