import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

test('application runtime excludes retired map cache and download modules', async () => {
  const result = await build({
    entryPoints: ['app/page.tsx'], bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'esm', packages: 'external', jsx: 'automatic',
    loader: { '.css': 'empty' }, logLevel: 'silent',
    plugins: [{ name: 'worker-asset-reference', setup(b) {
      b.onResolve({ filter: /\?(?:worker&)?url$/ }, args => ({ path: args.path, namespace: 'asset-reference' }));
      b.onLoad({ filter: /.*/, namespace: 'asset-reference' }, () => ({ contents: 'export default "worker.js"' }));
    } }],
  });
  const retired = /(?:^|\/)modules\/(?:outdoor\/(?:browseCache|browseCacheRoute|browseTileSources|useBrowseCacheRoute|BrowseCacheSettings|OfflineDownload|OfflinePanel|OfflineMapSettings|useOffline|useOfflineMapMode|offline|importedRouteDownload)\.(?:ts|tsx)|collections\/OfflineMapFolder\.tsx)$/;
  assert.deepEqual(Object.keys(result.metafile.inputs).filter(file => retired.test(file.replaceAll('\\', '/'))), []);
  // Installed old map packages no longer intercept every WebView request.
  const gateway = readFileSync('mobile/android/src/com/guanyun/weather/LocalGateway.java', 'utf8');
  assert.doesNotMatch(gateway, /OfflineStore\.hit/);
  const manifest = readFileSync('mobile/android/AndroidManifest.xml', 'utf8');
  assert.doesNotMatch(manifest, /android:name="com\.guanyun\.weather\.OfflineDownloadService"/);
});
