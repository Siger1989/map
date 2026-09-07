import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';
import { browserRuntime } from './browser-runtime.mjs';
import { makeFixtures } from './map-source-fixtures.mjs';

const root = resolve('mobile/dist'),
  apk = resolve('mobile/.build/Shantu-0.2.5-test-unsigned.apk');
const archive = unzipSync(await readFile(apk));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}
const bundled = await files(root);
for (const path of bundled) {
  const name = relative(root, path).split(sep).join('/');
  assert.ok(archive[`assets/${name}`], `APK missing ${name}`);
  assert.equal(
    digest(archive[`assets/${name}`]),
    digest(await readFile(path)),
    `asset mismatch ${name}`,
  );
}
assert.ok(bundled.some((path) => /sql-wasm.*\.wasm$/.test(path)));
assert.ok(bundled.some((path) => /offline\.worker.*\.js$/.test(path)));
console.log(
  JSON.stringify({
    result: 'PASS',
    apkBytes: (await stat(apk)).size,
    verifiedAssets: bundled.length,
    sha256: digest(await readFile(apk)),
  }),
);

const fixtures = await makeFixtures();
const browser = await browserRuntime().chromium.launch({
  headless: true,
  executablePath:
    process.env.EDGE_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const timer = setTimeout(() => process.exit(2), 120000);
try {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 },
    hasTouch: true,
    offline: true,
  });
  const requested = new Set();
  // Model Android's bundled HTTPS resource gateway; every remote request stays offline.
  await context.route('https://shantu-bundle.test/**', async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname),
      path = resolve(root, '.' + name);
    if (path !== root && !path.startsWith(root + sep))
      return route.fulfill({ status: 403, body: '' });
    try {
      const target = name === '/' ? resolve(root, 'index.html') : path;
      const body = await readFile(target);
      requested.add(relative(root, target));
      await route.fulfill({
        status: 200,
        body,
        contentType:
          {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.mjs': 'text/javascript',
            '.wasm': 'application/wasm',
            '.css': 'text/css',
            '.png': 'image/png',
            '.json': 'application/json',
            '.woff2': 'font/woff2',
          }[extname(target)] || 'application/octet-stream',
      });
    } catch {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: '{}',
      });
    }
  });
  const page = await context.newPage(),
    errors = [];
  await page.addInitScript(() => {
    window.__offlineTileMessages = 0;
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('offline.worker'))
          this.addEventListener('message', ({ data }) => {
            if (data.result instanceof Uint8Array && data.result.length > 8)
              window.__offlineTileMessages++;
          });
      }
    };
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('https://shantu-bundle.test/', {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('.maplibregl-canvas').waitFor();
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('button', { name: '地图图源', exact: true }).click();
  const panel = page.locator('.map-sources');
  for (const filename of ['test.mbtiles', 'test.tif']) {
    await panel.getByRole('button', { name: /添加地图/ }).click();
    await panel
      .getByLabel('选择地图文件', { exact: true })
      .setInputFiles(`${fixtures}/${filename}`);
    await panel
      .getByRole('button', { name: '确认添加并使用', exact: true })
      .click({ timeout: 45000 });
    await panel
      .getByRole('status')
      .filter({ hasText: '离线地图已加载' })
      .waitFor({ timeout: 30000 });
    if (filename.endsWith('.mbtiles'))
      await page.waitForFunction(() => window.__offlineTileMessages > 0);
  }
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.maplibregl-canvas').waitFor();
  await page.getByRole('button', { name: '工具', exact: true }).click();
  await page.getByRole('button', { name: '地图图源', exact: true }).click();
  await panel
    .getByRole('status')
    .filter({ hasText: '离线地图已加载' })
    .waitFor();
  assert.match(await panel.innerText(), /已保存 2 \/ 20/);
  await panel.getByRole('button', { name: /离线测试地图 MBTiles/ }).click();
  await page.waitForFunction(() => window.__offlineTileMessages > 0);
  await panel
    .getByRole('status')
    .filter({ hasText: '离线地图已加载' })
    .waitFor();
  await page.screenshot({
    path: 'artifacts/screenshots/map-sources-bundled-offline-360.png',
  });
  assert.ok([...requested].some((name) => /sql-wasm.*\.wasm$/.test(name)));
  assert.ok([...requested].some((name) => /offline\.worker.*\.js$/.test(name)));
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'PASS',
      checks:
        'production Android web assets, no internet, MBTiles/GeoTIFF import, reload and reselect, local worker and WASM',
      localRequests: requested.size,
    }),
  );
} finally {
  clearTimeout(timer);
  await browser.close();
}
