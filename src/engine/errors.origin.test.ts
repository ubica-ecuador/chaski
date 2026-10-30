import { explainError } from './errors';

// jsdom's page is http://localhost/, which stands for Grafana's origin here.
describe("explainError on a read of Grafana's origin", () => {
  it('says the worker refused it, and what to do instead', () => {
    const e = explainError(new Error('IO Error: No files found that match the pattern "http://localhost/api/user"'));
    expect(e.kind).toBe('grafana-origin');
    expect(e.message).toContain("SQL may not read Grafana's own address");
    expect(e.message).toContain("$__proxy('…')");
  });

  it('leaves a failed read through a Chaski proxy route, or of another host, to the other explanations', () => {
    for (const url of [
      'http://localhost/api/datasources/proxy/uid/files/_plain/missing.parquet',
      'https://elsewhere.example/api/user',
    ]) {
      expect(explainError(new Error(`IO Error: No files found that match the pattern "${url}"`)).kind).toBe('sql');
    }
  });
});
