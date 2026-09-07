import { browserRuntime } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
const { chromium } = browserRuntime();
const timer = setTimeout(() => process.exit(2), 150000);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
try {
  for (const [width, height] of [
    [390, 844],
    [360, 780],
  ]) {
    const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: true,
        timezoneId: 'Asia/Shanghai',
      }),
      page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      if (!localStorage.getItem('photo-test-ready')) {
        const time = Date.UTC(2026, 8, 7, 2);
        localStorage.setItem(
          'guanyun.manual-tracks.v1',
          JSON.stringify([
            {
              id: 'photo-track',
              name: '照片测试行程',
              createdAt: time,
              segments: [
                [
                  [104.066, 30.659],
                  [104.0661, 30.659],
                ],
              ],
              samples: [
                [
                  { time, altitude: 500 },
                  { time: time + 60000, altitude: 501 },
                ],
              ],
            },
          ]),
        );
        localStorage.setItem('photo-test-ready', '1');
      }
    });
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
    await page.goto('http://localhost:3000/#16/30.659/104.066/-24/50', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForFunction(() => window.__map?.isStyleLoaded(), null, {
      timeout: 35000,
    });
    const open = async () => {
      await page.getByRole('button', { name: '行程', exact: true }).click();
      await page.getByRole('button', { name: '照片', exact: true }).click();
    };
    await open();
    const choose = page.locator('.photo-panel input[type=file]').first();
    await choose.setInputFiles([
      'tests/fixtures/photos/timed.jpg',
      'tests/fixtures/photos/timed-second.jpg',
      'tests/fixtures/photos/untimed.png',
    ]);
    await page.getByText('可匹配 2 / 3 张', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('拍摄时间 1', { exact: true }).inputValue(),
      '2026-09-07T10:00:30',
    );
    await page.screenshot({
      path: `artifacts/screenshots/photos-match-${width}-${height}.png`,
    });
    await page
      .getByRole('button', { name: '加入地图（2）', exact: true })
      .click();
    await page.getByText('已存 2 张', { exact: true }).waitFor();
    await page
      .getByLabel('拍摄时间 1', { exact: true })
      .fill('2026-09-07T10:00:40');
    await page
      .getByRole('button', { name: '加入地图（1）', exact: true })
      .click();
    await page.getByText('已存 3 张', { exact: true }).waitFor();
    await choose.setInputFiles('tests/fixtures/photos/timed.jpg');
    await page
      .getByRole('button', { name: '加入地图（1）', exact: true })
      .click();
    await page
      .getByText('已加入 1 张照片预览；同轨迹重复照片自动更新', { exact: true })
      .waitFor();
    assert.equal(await page.locator('.photo-saved button').count(), 3);
    // Orientation 6 must yield a portrait thumbnail, without retaining EXIF in the preview.
    const storage = await page.evaluate(async () => {
      const { readPhotos, writePhotos } =
        await import('/modules/photos/storage.ts');
      const all = await readPhotos();
      const p = all.find((p) => p.name === 'timed.jpg'),
        bmp = await createImageBitmap(p.preview);
      let quotaRejected = false;
      try {
        await writePhotos(
          Array.from({ length: 201 }, (_, i) => ({ ...p, id: `quota-${i}` })),
        );
      } catch {
        quotaRejected = true;
      }
      const after = await readPhotos();
      const result = {
        quotaRejected,
        afterCount: after.length,
        count: all.length,
        width: bmp.width,
        height: bmp.height,
        point: p.coordinates,
      };
      bmp.close();
      return result;
    });
    assert.equal(storage.count, 3);
    assert.equal(storage.quotaRejected, true);
    assert.equal(storage.afterCount, 3);
    assert.ok(storage.height > storage.width);
    assert.ok(Math.abs(storage.point[0] - 104.06605) < 1e-8);
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page
      .getByRole('button', { name: '查看 3 张行程照片', exact: true })
      .click();
    const viewer = page.getByRole('dialog', { name: '行程照片预览' });
    await viewer.waitFor();
    const box = await viewer.boundingBox();
    assert.ok(box.height <= Math.min(height * 0.38, 320) + 1);
    assert.ok(box.x + box.width < width - 50);
    await page.getByRole('button', { name: '下一张', exact: true }).click();
    await page.screenshot({
      path: `artifacts/screenshots/photos-map-${width}-${height}.png`,
    });
    await page
      .getByRole('button', { name: '关闭照片预览', exact: true })
      .click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__map?.isStyleLoaded(), null, {
      timeout: 35000,
    });
    await page
      .getByRole('button', { name: '查看 3 张行程照片', exact: true })
      .waitFor();
    await open();
    await page
      .getByRole('button', { name: '隐藏地图照片', exact: true })
      .click();
    assert.equal(await page.locator('.trip-photo-marker').count(), 0);
    await page
      .getByRole('button', { name: '显示地图照片', exact: true })
      .click();
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page
      .getByRole('button', { name: '查看 3 张行程照片', exact: true })
      .click();
    await page.getByRole('button', { name: '移除预览', exact: true }).click();
    await page
      .getByRole('button', { name: '查看 2 张行程照片', exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(await page.locator('.camera-gizmo').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        width,
        height,
        checks:
          'real EXIF, timezone, manual time, local matching, duplicate import, orientation, IndexedDB reload, cluster preview, next image, hide/show, delete, mobile layout',
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
  clearTimeout(timer);
}
