import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url),
  {
    chromium,
  } = require('C:/Users/sigeryang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const timer = setTimeout(() => process.exit(2), 180000);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  timeout: 20000,
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { longitude: 103.28, latitude: 31.08, accuracy: 10 },
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/modules/map/TerrainMap.tsx*', async (route) => {
    const r = await route.fetch();
    await route.fulfill({
      response: r,
      body: (await r.text()).replace(
        'mapRef.current = map',
        'window.__map = map; mapRef.current = map',
      ),
    });
  });
  await page.goto('http://localhost:3000/#10.5/31.08/103.28/-24/65', {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  await page.waitForFunction(() => window.__map?.isStyleLoaded(), null, {
    timeout: 45000,
  });
  for (const [width, height] of [
    [390, 844],
    [360, 780],
  ]) {
    await page.setViewportSize({ width, height });
    assert.equal(await page.locator('.camera-gizmo').count(), 1);
    assert.equal(await page.locator('.section-button').count(), 0);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `artifacts/screenshots/outdoor-map-${width}-${height}.png`,
    });
    await page.getByRole('button', { name: '行程', exact: true }).click();
    const box = await page.locator('.control-popover').boundingBox();
    assert.ok(box.height <= Math.min(height * 0.38, 320) + 1);
    await page.screenshot({
      path: `artifacts/screenshots/outdoor-panel-${width}-${height}.png`,
    });
    await page.getByRole('button', { name: '数据', exact: true }).click();
    await page
      .locator('input[type=file]')
      .setInputFiles({
        name: 'test.gpx',
        mimeType: 'application/gpx+xml',
        buffer: Buffer.from(
          '<gpx version="1.1"><trk><name>测试导入</name><trkseg><trkpt lon="103.28" lat="31.08"/><trkpt lon="103.29" lat="31.08"/></trkseg></trk></gpx>',
        ),
      });
    await page.getByRole('button', { name: '确认合并', exact: true }).click();
    assert.ok(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('guanyun.manual-tracks.v1')).some(
          (t) => t.name === '测试导入',
        ),
      ),
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '存档备份', exact: true }).click();
    assert.equal((await download).suggestedFilename(), 'guanyun-backup.json');
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await page.getByRole('button', { name: '工具', exact: true }).click();
    assert.ok(
      await page
        .getByRole('button', { name: '视角盘', exact: true })
        .isVisible(),
    );
    await page.getByRole('button', { name: '视角盘', exact: true }).click();
    assert.equal(await page.locator('.camera-gizmo').count(), 0);
    await page.getByRole('button', { name: '工具', exact: true }).click();
    await page.getByRole('button', { name: '视角盘', exact: true }).click();
    console.log('PASS mobile UI import/export/tools', width, height);
  }
  await page.getByRole('button', { name: '行程', exact: true }).click();
  await page.getByRole('button', { name: '开始记录', exact: true }).click();
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem('guanyun.recording.v1')).segments.flat()
        .length === 1,
  );
  await context.setGeolocation({
    longitude: 103.281,
    latitude: 31.08,
    accuracy: 10,
  });
  await page.waitForTimeout(1600);

  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '继续记录', exact: true }).click();
  await context.setGeolocation({
    longitude: 103.282,
    latitude: 31.08,
    accuracy: 10,
  });
  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: '结束记录', exact: true }).click();
  assert.equal(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('guanyun.recording.v1')).phase,
    ),
    'finished',
  );
  assert.deepEqual(errors, []);
  console.log('PASS foreground recording pause/resume and runtime errors');
} finally {
  await browser.close();
  clearTimeout(timer);
}
