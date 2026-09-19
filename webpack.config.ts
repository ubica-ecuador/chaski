import CopyWebpackPlugin from 'copy-webpack-plugin';
import path from 'path';
import type { Configuration } from 'webpack';
import { merge } from 'webpack-merge';

import grafanaConfig, { type Env } from './.config/webpack/webpack.config';

const DUCKDB_DIST = path.resolve(process.cwd(), 'node_modules/@duckdb/duckdb-wasm/dist');

const config = async (env: Env): Promise<Configuration> => {
  const baseConfig = await grafanaConfig(env);

  return merge(baseConfig, {
    plugins: [
      /*
       * DuckDB-WASM loads its wasm and worker by URL at runtime, and its
       * extensions from a repository URL, so all of them must sit next to
       * module.js. `eh` is the single-threaded build: Grafana sends no
       * COOP/COEP headers, so the threaded one could never start.
       */
      new CopyWebpackPlugin({
        patterns: [
          // `info: { minimized: true }` tells TerserPlugin these assets are
          // already minimized, so it skips them instead of re-mangling and
          // re-emitting the worker — vendored DuckDB assets must ship byte
          // for byte as published, not re-minified.
          { from: path.join(DUCKDB_DIST, 'duckdb-eh.wasm'), to: '.', info: { minimized: true } },
          { from: path.join(DUCKDB_DIST, 'duckdb-browser-eh.worker.js'), to: '.', info: { minimized: true } },
          {
            from: path.resolve(process.cwd(), 'vendor/duckdb-extensions'),
            to: 'extensions',
            info: { minimized: true },
          },
        ],
      }),
    ],
  });
};

export default config;
