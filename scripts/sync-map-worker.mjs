import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, 'public/vendor/maplibre');
mkdirSync(destination, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(
    resolve(root, 'node_modules/maplibre-gl/dist', file),
    resolve(destination, file),
  );
}
copyFileSync(
  resolve(root, 'node_modules/maplibre-gl/LICENSE.txt'),
  resolve(destination, 'LICENSE.txt'),
);
console.log('MapLibre module workers synced for development and production.');
