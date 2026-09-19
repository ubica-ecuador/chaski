// Downloads the DuckDB-WASM extensions this plugin serves from its own dist/.
// A signed Grafana plugin cannot load code from a CDN, so they ship inside it.
// The DuckDB version is read from src/engine/duckdbVersion.ts, the one place
// that states it.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXTENSIONS = ['parquet', 'json', 'httpfs', 'spatial'];
const PLATFORM = 'wasm_eh';

const source = await readFile(path.join(process.cwd(), 'src/engine/duckdbVersion.ts'), 'utf8');
const version = /DUCKDB_VERSION = '(v[\d.]+)'/.exec(source)?.[1];
if (!version) {
  throw new Error('DUCKDB_VERSION not found in src/engine/duckdbVersion.ts');
}

const dir = path.join(process.cwd(), 'vendor', 'duckdb-extensions', version, PLATFORM);
await mkdir(dir, { recursive: true });

for (const name of EXTENSIONS) {
  const file = path.join(dir, `${name}.duckdb_extension.wasm`);
  const present = await stat(file).then((s) => s.size > 0, () => false);
  if (present) {
    continue;
  }
  const url = `https://extensions.duckdb.org/${version}/${PLATFORM}/${name}.duckdb_extension.wasm`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
  console.log(`fetched ${name} (${(await stat(file)).size} bytes)`);
}
