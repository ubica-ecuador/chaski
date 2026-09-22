// Saves a snapshot of the USGS earthquake feed into fixtures/, for step 3 of
// docs/tutorial-earthquakes.md: the fixtures server then offers it behind a
// token, the way a private API would. The feed is live, so the file is a
// snapshot of one moment and git ignores it.
//
// Run: node scripts/fetch-quakes.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson';
const target = path.join(process.cwd(), 'fixtures', 'quakes.geojson');

const response = await fetch(FEED);
if (!response.ok) {
  throw new Error(`${FEED}: HTTP ${response.status}`);
}
const text = await response.text();
const { features } = JSON.parse(text);
await writeFile(target, text);
console.log(`wrote ${target}: ${features.length} earthquakes, ${(text.length / 1048576).toFixed(1)} MB`);
