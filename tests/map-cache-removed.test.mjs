import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

test('route packages remain explicit; native cache reads use only the explicit cache endpoint', async () => {
  const result = await build({
    entryPoints: ['app/page.tsx'], bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'esm', packages: 'external', jsx: 'automatic',
    loader: { '.css': 'empty' }, logLevel: 'silent',
    plugins: [{ name: 'worker-asset-reference', setup(b) {
      b.onResolve({ filter: /\?(?:worker&)?url$/ }, args => ({ path: args.path, namespace: 'asset-reference' }));
      b.onLoad({ filter: /.*/, namespace: 'asset-reference' }, () => ({ contents: 'export default "worker.js"' }));
    } }],
  });
  const retired = /(?:^|\/)modules\/(?:outdoor\/(?:browseCacheRoute|browseTileSources|useBrowseCacheRoute|BrowseCacheSettings|OfflineDownload|OfflinePanel|OfflineMapSettings)\.(?:ts|tsx)|collections\/OfflineMapFolder\.tsx)$/;
  assert.deepEqual(Object.keys(result.metafile.inputs).filter(file => retired.test(file.replaceAll('\\', '/'))), []);
  // Cache reads must not intercept unrelated WebView requests or silently download misses.
  const gateway = readFileSync('mobile/android/src/com/guanyun/weather/LocalGateway.java', 'utf8');
  assert.match(gateway, /\/api\/offline-tile/);
  assert.equal((gateway.match(/OfflineStore\.hit/g) ?? []).length, 1);
  const manifest = readFileSync('mobile/android/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /android:name="com\.guanyun\.weather\.OfflineDownloadService"[^>]+android:exported="false"[^>]+android:foregroundServiceType="dataSync"/);
});
