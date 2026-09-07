import { browserRuntime } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
const { chromium } = browserRuntime();
const browser = await chromium.launch({
  headless: true,
  executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const timer = setTimeout(() => process.exit(2), 150000);
try {
  for (const [width, height, lng, lat] of [
    [390, 844, -0.1276, 51.5072],
    [360, 780, 139.6917, 35.6895],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
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
    await page.goto('http://localhost:3000/', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__map?.isStyleLoaded(), null, {
      timeout: 40000,
    });
    assert.equal(await page.locator('.topbar h1').textContent(), '山兔');
    assert.equal(await page.locator('.topbar .region').count(), 0);
    assert.match(await page.title(), /^山兔/);
    const initial = await page.evaluate(() => ({
      center: window.__map.getCenter().toArray(),
      zoom: window.__map.getZoom(),
      min: window.__map.getMinZoom(),
      pitch: window.__map.getPitch(),
    }));
    assert.ok(
      Math.abs(initial.center[0]) < 0.01 &&
        Math.abs(initial.center[1] - 20) < 0.01,
    );
    assert.equal(initial.min, 0);
    assert.equal(initial.zoom, 1);
    assert.equal(initial.pitch, 0);
    const box = await page.locator('.topbar').boundingBox();
    assert.ok(box.width < 150 && box.x + box.width < width - 50);
    await page.screenshot({
      path: `artifacts/screenshots/shantu-world-${width}-${height}.png`,
    });
    await page.evaluate(
      ([lng, lat]) =>
        window.__map.jumpTo({
          center: [lng, lat],
          zoom: 11,
          pitch: 40,
          bearing: 20,
        }),
      [lng, lat],
    );
    await page.waitForFunction(
      ([lng, lat]) =>
        Math.abs(window.__map.getCenter().lng - lng) < 0.001 &&
        Math.abs(window.__map.getCenter().lat - lat) < 0.001 &&
          /^#11\//.test(location.hash),
      [lng, lat],
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      ([lng, lat]) =>
        window.__map &&
        Math.abs(window.__map.getCenter().lng - lng) < 0.001 &&
        Math.abs(window.__map.getCenter().lat - lat) < 0.001,
      [lng, lat],
    );
    await page.waitForFunction(() => window.__map?.isStyleLoaded(), null, {
      timeout: 40000,
    });
    await page.screenshot({
      path: `artifacts/screenshots/shantu-overseas-${width}-${height}.png`,
    });
    await page
      .getByRole('button', { name: '查看世界地图', exact: true })
      .click();
    await page.waitForFunction(
      () =>
        !window.__map.isMoving() &&
        Math.abs(window.__map.getCenter().lng) < 0.01 &&
        Math.abs(window.__map.getCenter().lat - 20) < 0.01 &&
        window.__map.getZoom() < 1.01,
    );
    assert.equal(await page.locator('.camera-gizmo').isVisible(), true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        width,
        height,
        overseas: [lng, lat],
        checks:
          'Shantu title, removed region, world entry, min zoom, overseas view and URL restore, world reset, responsive header, no runtime errors',
      }),
    );
    await context.close();
  }
} finally {
  clearTimeout(timer);
  await browser.close();
}
