import {
  explainProxyError,
  explainProxyStatus,
  KEY_ROUTE,
  PLAIN_ROUTE,
  proxyBaseUrl,
  proxyUrlIn,
} from './proxy';

describe('proxyBaseUrl', () => {
  it('resolves the instance URL on the page origin, with the route', () => {
    expect(proxyBaseUrl('/api/datasources/proxy/uid/abc', PLAIN_ROUTE, 'https://g.example/')).toBe(
      'https://g.example/api/datasources/proxy/uid/abc/_plain'
    );
  });

  it('adds the sub-path Grafana is served from', () => {
    expect(proxyBaseUrl('/api/datasources/proxy/uid/abc', KEY_ROUTE, 'https://g.example/grafana/')).toBe(
      'https://g.example/grafana/api/datasources/proxy/uid/abc/_key'
    );
  });

  it('does not add the sub-path twice when the instance URL already has it', () => {
    expect(proxyBaseUrl('/grafana/api/datasources/proxy/uid/abc', PLAIN_ROUTE, 'https://g.example/grafana/')).toBe(
      'https://g.example/grafana/api/datasources/proxy/uid/abc/_plain'
    );
  });
});

// The text DuckDB-WASM gave in the spike for a wrong token (the proxy answered 400), a missing file
// (404) and an instance with no URL (502): the same message every time, with no status in it.
const WRONG_TOKEN =
  'IO Error: No files found that match the pattern "http://localhost:3005/api/datasources/proxy/uid/duckdbwasm-bearer-wrong/_plain/sample.parquet"\n\n' +
  "LINE 1: SELECT count(*)::DOUBLE AS n FROM read_parquet('http://localhost:3005/api/datasources/proxy...\n" +
  '                                          ^';
const WRONG_TOKEN_URL = 'http://localhost:3005/api/datasources/proxy/uid/duckdbwasm-bearer-wrong/_plain/sample.parquet';
const PROXY_BASE = 'http://localhost:3005/api/datasources/proxy/uid/duckdbwasm-bearer-wrong/_plain';

// A mistyped query using $__proxy: DuckDB's parser error echoes the SQL line, which carries the
// expanded proxy URL as a quoted string literal, not as a read failure.
const PARSER_ERROR_ECHOING_PROXY_URL =
  'Parser Error: syntax error at or near "read_parquet"\n' +
  "LINE 1: SELECT * FORM read_parquet(('http://localhost/api/datasources/proxy/uid/duckdbwasm/_plain/' || ('x.parquet')))";

describe('proxyUrlIn', () => {
  it('finds the URL a DuckDB IO-error read failure names', () => {
    expect(proxyUrlIn(WRONG_TOKEN)).toBe(WRONG_TOKEN_URL);
  });

  it('finds any URL an IO-error read failure names, proxy or not (callers filter by instance)', () => {
    expect(proxyUrlIn('IO Error: No files found that match the pattern "https://x.example/y.parquet"')).toBe(
      'https://x.example/y.parquet'
    );
  });

  it('finds nothing outside the IO-error shape, even when the text echoes a proxy URL', () => {
    expect(proxyUrlIn(PARSER_ERROR_ECHOING_PROXY_URL)).toBeUndefined();
    expect(proxyUrlIn('Parser Error: syntax error at or near "SELEC"')).toBeUndefined();
  });
});

describe('explainProxyStatus', () => {
  const detail = 'IO Error: No files found that match the pattern "…"';

  it('explains rejected credentials, including the 400 Grafana turns an upstream 401 into', () => {
    for (const status of [400, 401, 403]) {
      const message = explainProxyStatus(status, detail);
      expect(message).toContain(`refused the request (HTTP ${status})`);
      expect(message).toContain('credentials');
      expect(message).toContain(detail);
    }
  });

  it('explains a missing file', () => {
    expect(explainProxyStatus(404, detail)).toContain(
      "Not found on the server behind this datasource's proxy (HTTP 404)"
    );
  });

  it('explains an unreachable server', () => {
    for (const status of [502, 503, 504]) {
      expect(explainProxyStatus(status, detail)).toContain(
        `Grafana could not reach the server behind this datasource's proxy (HTTP ${status})`
      );
    }
  });

  it('falls back to a general message when the status is unknown or says nothing is wrong', () => {
    for (const status of [undefined, 200, 500]) {
      expect(explainProxyStatus(status, detail)).toContain("Reading through this datasource's proxy failed");
    }
  });
});

describe('explainProxyError', () => {
  it('asks the proxy for the status of the URL DuckDB could not read, and explains it', async () => {
    const status = jest.fn(async () => 400);
    const message = await explainProxyError(new Error(WRONG_TOKEN), PROXY_BASE, status);
    expect(status).toHaveBeenCalledWith(WRONG_TOKEN_URL);
    expect(message).toContain('refused the request (HTTP 400)');
    expect(message).toContain('No files found that match the pattern');
    expect(message).not.toContain('LINE 1');
  });

  it('leaves other errors alone without asking anything', async () => {
    const status = jest.fn(async () => 404);
    expect(
      await explainProxyError(new Error('Parser Error: syntax error at or near "SELEC"'), PROXY_BASE, status)
    ).toBeUndefined();
    expect(status).not.toHaveBeenCalled();
  });

  it('leaves a parser error alone even when it echoes a proxy URL of this instance, without probing', async () => {
    const status = jest.fn(async () => 400);
    const echoedBase = 'http://localhost/api/datasources/proxy/uid/duckdbwasm/_plain';
    expect(await explainProxyError(new Error(PARSER_ERROR_ECHOING_PROXY_URL), echoedBase, status)).toBeUndefined();
    expect(status).not.toHaveBeenCalled();
  });

  it("leaves an IO error naming another instance's URL alone, without probing", async () => {
    const status = jest.fn(async () => 400);
    const anotherUid = 'http://localhost:3005/api/datasources/proxy/uid/duckdbwasm-bearer/_plain';
    const anotherHost = 'http://other-host:3005/api/datasources/proxy/uid/duckdbwasm-bearer-wrong/_plain';
    expect(await explainProxyError(new Error(WRONG_TOKEN), anotherUid, status)).toBeUndefined();
    expect(await explainProxyError(new Error(WRONG_TOKEN), anotherHost, status)).toBeUndefined();
    expect(status).not.toHaveBeenCalled();
  });

  it('returns undefined without a base to compare against, whatever the URL', async () => {
    const status = jest.fn(async () => 400);
    expect(await explainProxyError(new Error(WRONG_TOKEN), undefined, status)).toBeUndefined();
    expect(status).not.toHaveBeenCalled();
  });

  it('returns undefined when the proxy answers 2xx: the read failed for some other reason', async () => {
    const status = jest.fn(async () => 200);
    expect(await explainProxyError(new Error(WRONG_TOKEN), PROXY_BASE, status)).toBeUndefined();
    expect(status).toHaveBeenCalledWith(WRONG_TOKEN_URL);
  });
});
