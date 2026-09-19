// Jest setup provided by Grafana scaffolding, loaded only where there is a DOM:
// engine tests run under `@jest-environment node` with DuckDB's Node build, and
// the scaffold's setup touches browser globals (HTMLCanvasElement, matchMedia).
if (typeof window !== 'undefined') {
  require('./.config/jest-setup');
}
