// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

const base = require('./.config/jest.config');

module.exports = {
  // Jest configuration provided by Grafana scaffolding
  ...base,
  moduleNameMapper: {
    ...base.moduleNameMapper,
    // Only mosaic-core asks for a module by this relative name.
    '^\\./connectors/wasm\\.js$': '<rootDir>/jest/mosaic-wasm-connector.js',
  },
  // Mosaic ships ES modules only.
  transformIgnorePatterns: [nodeModulesToTransform([...grafanaESModules, '@uwdata'])],
};
