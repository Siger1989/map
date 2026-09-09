import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { transform } from 'esbuild';

/** Public workers bypass Vite's JS target, so lower their staged copies as well. */
export default function mobileWorkerCompatibility() {
  return {
    name: 'shantu-mobile-worker-compatibility',
    apply: 'build',
    async writeBundle(options) {
      if (!options.dir) throw new Error('Mobile output directory is required');
      for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
        const path = resolve(options.dir, 'vendor/maplibre', name);
        const result = await transform(await readFile(path, 'utf8'), {
          loader: 'js',
          target: 'chrome99',
          format: 'esm',
          minify: true,
          legalComments: 'inline',
        });
        await writeFile(path, result.code);
      }
    },
  };
}
