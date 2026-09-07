import { browserRuntime } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeFixtures, mapTile } from './map-source-fixtures.mjs';

const directory = await makeFixtures(),
  tile = mapTile();
const browser = await browserRuntime().chromium.launch({
  headless: true,
  executablePath:
    process.env.EDGE_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const timer = setTimeout(() => process.exit(2), 300000);
let currentPage;
try {
  for (const [width, height] of [
    [390, 844],
    [360, 780],
  ]) {
    const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: true,
      }),
      page = await context.newPage(),
      errors = [];
    currentPage = page;
    page.setDefaultTimeout(30000);
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        throw new DOMException('fixture denied', 'NotAllowedError');
      };
    });
    await page.route('**/modules/map/TerrainMap.tsx*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text()).replace(
          'mapRef.current = map',
          'window.__map = map; mapRef.current = map',
        ),
      });
    });
    let tileRequests = 0;
    await page.route('https://maps.example.org/**', (route) => {
      tileRequests++;
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: tile,
      });
    });
    await page.goto('http://localhost:3000/', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => window.__map?.getLayer('hillshade'),
      null,
      { timeout: 45000 },
    );
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await page.getByRole('button', { name: '地图图源', exact: true }).click();
    const panel = page.locator('.map-sources');
    await panel.getByRole('button', { name: /添加地图/ }).click();
    await panel.getByLabel('图源名称', { exact: true }).fill('在线测试');
    await panel
      .getByLabel('图源地址或配置', { exact: true })
      .fill('https://maps.example.org/{z}/{x}/{y}.png');
    await panel
      .getByRole('button', { name: '识别并预览', exact: true })
      .click();
    const renderedTile = page.waitForResponse((response) =>
      response.url().startsWith('https://maps.example.org/'),
    );
    await panel
      .getByRole('button', { name: '确认添加并使用', exact: true })
      .click();
    await page.waitForFunction(() => window.__map?.getLayer('shantu-user-map'));
    await page.waitForFunction(() =>
      window.__map?.isSourceLoaded('shantu-user-map'),
    );
    await renderedTile;
    assert.ok(tileRequests > 0);
    assert.equal(
      await page.evaluate(() =>
        window.__map.getLayoutProperty('detail', 'visibility'),
      ),
      'none',
    );
    assert.equal(
      await page.evaluate(() =>
        window.__map.getLayoutProperty('open-water', 'visibility'),
      ),
      'none',
    );
    await page.evaluate(() => {
      window.__map.addSource('qa-trip-overlay', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      window.__map.addLayer({
        id: 'qa-trip-overlay',
        type: 'circle',
        source: 'qa-trip-overlay',
      });
    });
    await panel.getByRole('button', { name: /添加地图/ }).click();
    await panel
      .getByLabel('图源地址或配置', { exact: true })
      .fill('ovitalmap://encrypted');
    await panel
      .getByRole('button', { name: '识别并预览', exact: true })
      .click();
    await panel.getByRole('alert').filter({ hasText: '专有' }).waitFor();
    assert.equal(
      await page.evaluate(
        () => window.__map.getSource('shantu-user-map').serialize().tiles[0],
      ),
      'https://maps.example.org/{z}/{x}/{y}.png',
    );
    await panel.getByLabel('选择二维码图片', { exact: true }).setInputFiles({
      name: 'qr.png',
      mimeType: 'image/png',
      buffer: await readFile('tests/fixtures/map-sources-qr.png'),
    });
    await page.waitForFunction(
      () =>
        document.querySelector('.map-sources textarea')?.value ===
        'https://maps.example.org/{z}/{x}/{y}.png',
    );
    await panel.getByRole('button', { name: '相机扫码', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: '相机未开启' }).waitFor();
    await panel.getByRole('button', { name: '关闭扫码', exact: true }).click();
    // A canvas-backed media stream exercises the real video decoder without a physical camera.
    await page.evaluate(
      async (base64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${base64}`;
        await img.decode();
        window.__scanCanvas = document.createElement('canvas');
        window.__scanCanvas.width = 512;
        window.__scanCanvas.height = 512;
        const ctx = window.__scanCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 512, 512);
        ctx.drawImage(img, 0, 0, 512, 512);
        navigator.mediaDevices.getUserMedia = async () => {
          window.__scanStream = window.__scanCanvas.captureStream(10);
          clearInterval(window.__scanPump);
          window.__scanPump = setInterval(() => {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, 1, 1);
          }, 100);
          return window.__scanStream;
        };
      },
      (await readFile('tests/fixtures/map-sources-qr.png')).toString('base64'),
    );
    await panel.getByRole('button', { name: '相机扫码', exact: true }).click();
    await page.waitForFunction(() =>
      window.__scanStream
        ?.getTracks()
        .every((track) => track.readyState === 'ended'),
    );
    await panel.getByLabel('图源地址或配置', { exact: true }).waitFor();
    await page.evaluate(() => {
      const ctx = window.__scanCanvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 512, 512);
      window.__scanStream = null;
    });
    await panel.getByRole('button', { name: '相机扫码', exact: true }).click();
    await page.waitForFunction(() =>
      window.__scanStream
        ?.getTracks()
        .some((track) => track.readyState === 'live'),
    );
    await panel.getByRole('button', { name: '关闭扫码', exact: true }).click();
    assert.ok(
      await page.evaluate(() =>
        window.__scanStream
          .getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
    );
    await page.evaluate(() => clearInterval(window.__scanPump));
    await panel
      .getByLabel('选择地图文件', { exact: true })
      .setInputFiles(`${directory}/test.mbtiles`);
    await panel
      .getByRole('button', { name: '确认添加并使用', exact: true })
      .waitFor({ timeout: 45000 });
    await panel
      .getByRole('button', { name: '确认添加并使用', exact: true })
      .click();
    await page.waitForFunction(() =>
      window.__map
        ?.getSource('shantu-user-map')
        ?.serialize()
        .tiles?.[0]?.startsWith('shantu-map://'),
    );
    await panel
      .getByRole('status')
      .filter({ hasText: '离线地图已加载' })
      .waitFor();
    assert.ok(
      await page.evaluate(() => window.__map.getLayer('qa-trip-overlay')),
    );
    await context.setOffline(true);
    await page.evaluate(() =>
      window.__map.jumpTo({ center: [120, 35], zoom: 3, pitch: 0, bearing: 0 }),
    );
    await page.waitForFunction(() =>
      window.__map.isSourceLoaded('shantu-user-map'),
    );
    await page.screenshot({
      path: `artifacts/screenshots/map-sources-offline-${width}.png`,
    });
    await context.setOffline(false);
    await panel.getByRole('button', { name: /添加地图/ }).click();
    await panel
      .getByLabel('选择地图文件', { exact: true })
      .setInputFiles(`${directory}/test.tif`);
    await panel
      .getByRole('button', { name: '确认添加并使用', exact: true })
      .waitFor({ timeout: 45000 });
    await panel
      .getByRole('button', { name: '确认添加并使用', exact: true })
      .click();
    await page.waitForFunction(
      () =>
        window.__map?.getSource('shantu-user-map')?.serialize().type ===
        'image',
    );
    await panel
      .getByRole('status')
      .filter({ hasText: '离线地图已加载' })
      .waitFor();
    await page.waitForFunction(
      () =>
        !window.__map.isMoving() &&
        window.__map.isSourceLoaded('shantu-user-map'),
    );
    assert.match(await panel.innerText(), /已保存 3 \/ 20/);
    assert.equal(await panel.locator('.map-source-choice').count(), 3);
    const coordinates = await page.evaluate(
      () => window.__map.getSource('shantu-user-map').serialize().coordinates,
    );
    assert.ok(
      Math.abs(coordinates[0][0] - 103) < 0.0001 &&
        Math.abs(coordinates[0][1] - 31) < 0.0001,
    );
    await page.screenshot({
      path: `artifacts/screenshots/map-sources-tiff-${width}.png`,
    });
    const bounds = await page.locator('.control-popover').boundingBox();
    assert.ok(bounds.height <= Math.min(320, height * 0.38) + 2);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        window.__map?.getSource('shantu-user-map')?.serialize().type ===
        'image',
      null,
      { timeout: 45000 },
    );
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await page.getByRole('button', { name: '地图图源', exact: true }).click();
    await panel.getByRole('button', { name: '移除 test', exact: true }).click();
    await panel.getByRole('button', { name: '确认移除', exact: true }).click();
    await page.waitForFunction(
      () => !window.__map?.getSource('shantu-user-map'),
    );
    await panel.getByRole('button', { name: '地表影像', exact: true }).click();
    await page.waitForFunction(
      () =>
        window.__map.getLayoutProperty('detail', 'visibility') === 'visible',
    );
    await panel.getByRole('button', { name: /离线测试地图 MBTiles/ }).click();
    await page.waitForFunction(() =>
      window.__map
        ?.getSource('shantu-user-map')
        ?.serialize()
        .tiles?.[0]?.startsWith('shantu-map://'),
    );
    // IndexedDB quota and failed transaction must retain all previous sources.
    const atomic = await page.evaluate(async () => {
      const s = await import('/modules/mapSources/storage.ts');
      const before = await s.listMaps();
      let rejected = false;
      try {
        await s.addMaps(
          Array.from({ length: 21 }, (_, i) => ({
            ...before[0],
            id: crypto.randomUUID(),
          })),
        );
      } catch {
        rejected = true;
      }
      return {
        rejected,
        before: before.length,
        after: (await s.listMaps()).length,
      };
    });
    assert.ok(atomic.rejected);
    assert.equal(atomic.before, atomic.after);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        width,
        height,
        tileRequests,
        checks:
          'online tiles, QR image decoded, camera refusal fallback, proprietary rejection preserves map, MBTiles worker and offline display, GeoTIFF projected image, overlay retained, reload, remove fallback, atomic quota, compact panel',
      }),
    );
    await context.close();
  }
} catch (error) {
  console.error('FAILED', String(error));
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({
      path: 'artifacts/screenshots/map-sources-failure.png',
    });
    console.log(await currentPage.locator('body').innerText());
    console.log(
      await currentPage.evaluate(() => ({
        source: window.__map?.getSource('shantu-user-map')?.serialize(),
        styleLoaded: window.__map?.isStyleLoaded(),
      })),
    );
  }
  throw error;
} finally {
  clearTimeout(timer);
  await browser.close();
}
