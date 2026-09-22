import { KEY_ROUTE, PLAIN_ROUTE, proxyBaseUrl } from './proxy';

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
