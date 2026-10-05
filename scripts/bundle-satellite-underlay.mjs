import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Fixed global overview, not a user-area download or a runtime prefetcher.
const root = new URL('../public/basemaps/satellite-overview-v1/', import.meta.url);
const template = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg';
const jobs = [];
for (let z = 0; z <= 5; z++) for (let x = 0; x < 2 ** z; x++) for (let y = 0; y < 2 ** z; y++) jobs.push({ z, x, y });
const hashes = {}; let totalBytes = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const tile = jobs.shift(); if (!tile) return;
    const key = `${tile.z}/${tile.x}/${tile.y}.jpg`, file = new URL(key, root);
    let bytes;
    try { bytes = await readFile(file); } catch { /* download absent assets only */ }
    if (!bytes) {
      const url = template.replace('{z}', tile.z).replace('{x}', tile.x).replace('{y}', tile.y);
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(`Overview ${key}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
      // EOX returns tiny PNGs for some polar tiles even on its JPEG endpoint.
      const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
      if (bytes.length > 512000 || (!jpeg && !png)) throw Error(`Invalid image: ${key}`);
      await mkdir(new URL(`${tile.z}/${tile.x}/`, root), { recursive: true });
      await writeFile(file, bytes);
    }
    hashes[key] = createHash('sha256').update(bytes).digest('hex'); totalBytes += bytes.length;
  }
}));
await writeFile(new URL('SOURCE.json', root), JSON.stringify({
  name: 'EOxCloudless Sentinel-2 2025 global overview',
  source: template, sourcePage: 'https://maps.eox.at/',
  attribution: 'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)',
  license: 'CC BY-NC-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  projection: 'EPSG:3857', scheme: 'xyz', tileSize: 256, minzoom: 0, maxzoom: 5,
  modifications: 'None; original image bytes (JPEG, or upstream polar PNG). Low-resolution visual underlay only.',
  bytes: totalBytes, outputs_sha256: Object.fromEntries(Object.entries(hashes).sort()),
}, null, 2) + '\n');
console.log(JSON.stringify({ tiles: Object.keys(hashes).length, bytes: totalBytes }));
