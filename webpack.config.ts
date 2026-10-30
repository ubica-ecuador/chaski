import CopyWebpackPlugin from 'copy-webpack-plugin';
import path from 'path';
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';

import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const DUCKDB_DIST = path.resolve(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/dist');

/*
 * The app is one compilation with an entry per plugin: dist/module.js (the
 * app), dist/plugins/datasource/module.js and dist/plugins/mosaic/module.js.
 * Grafana serves each nested plugin from its own folder under its own id
 * (public/plugins/ubica-chaski-datasource/ is dist/plugins/datasource/), and
 * each module takes its public path from the URL it was loaded from. So a
 * nested plugin's files must sit in its folder, and none of them may split
 * off a lazy chunk: chunks land in dist/, where its public path never looks.
 * Plus (keplergl-grafana-plus-panel) builds a compilation per plugin for that.
 */
const DATASOURCE_DIR = 'plugins/datasource';

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  return merge(baseConfig, {
    plugins: [
      /*
       * DuckDB-WASM loads its wasm and worker by URL at runtime, and its
       * extensions from a repository URL, so all of them must sit next to
       * the datasource's module.js. `eh` is the single-threaded build:
       * Grafana sends no COOP/COEP headers, so the threaded one could never
       * start.
       */
      new CopyWebpackPlugin({
        patterns: [
          // `info: { minimized: true }` tells TerserPlugin these assets are
          // already minimized, so it skips them instead of re-mangling and
          // re-emitting the worker — vendored DuckDB assets must ship byte
          // for byte as published, not re-minified.
          { from: path.join(DUCKDB_DIST, 'duckdb-eh.wasm'), to: DATASOURCE_DIR, info: { minimized: true } },
          {
            from: path.join(DUCKDB_DIST, 'duckdb-browser-eh.worker.js'),
            to: DATASOURCE_DIR,
            info: { minimized: true },
          },
          {
            from: path.resolve(process.cwd(), 'vendor/duckdb-extensions'),
            to: `${DATASOURCE_DIR}/extensions`,
            info: { minimized: true },
          },
          // The scaffold copies the app's logo; each nested plugin brings its own.
          { from: 'plugins/*/img/**/*', to: '[path][name][ext]' },
          // Likewise only the app's README: Grafana shows each nested plugin's own as its overview.
          { from: 'plugins/*/README.md', to: '[path][name][ext]' },
        ],
      }),
    ],
  });
};

export default config;
