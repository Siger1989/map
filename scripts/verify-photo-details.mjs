import { browserRuntime } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
const { chromium } = browserRuntime();
const browser = await chromium.launch({
  headless: true,
  executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const timer = setTimeout(() => process.exit(2), 240000);
try {
  for (const [width, height] of [
    [390, 844],
    [360, 780],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      timezoneId: 'Asia/Shanghai',
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [];
    let weatherFailure = true;
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/v1/forecast?**', async (route) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.has('start_date')) return route.continue();
      if (weatherFailure) return route.fulfill({ status: 503, body: '{}' });
      const time =
        Date.parse(url.searchParams.get('start_date') + 'T00:00:00Z') / 1000;
      await route.fulfill({
        json: {
          hourly: {
            time: Array.from({ length: 24 }, (_, i) => time + i * 3600),
            temperature_2m: Array(24).fill(18),
            precipitation: Array(24).fill(0),
            wind_speed_10m: Array(24).fill(2),
            weather_code: Array(24).fill(2),
          },
        },
      });
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
    await page.addInitScript(() => {
      const time = Date.UTC(2026, 8, 7, 2);
      localStorage.setItem(
        'guanyun.manual-tracks.v1',
        JSON.stringify([
          {
            id: 'detail-track',
            name: '照片山路',
            source: 'recorded',
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
                { time: time + 60000, altitude: 502 },
              ],
            ],
          },
        ]),
      );
    });
    const go = async () => {
      await page.goto('http://localhost:3000/#16/30.659/104.066/-24/50', {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(() => !!window.__map);
    };
    await go();
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page.getByRole('button', { name: '照片', exact: true }).click();
    await page
      .locator('.photo-panel input[type=file]')
      .first()
      .setInputFiles('tests/fixtures/photos/timed.jpg');
    await page
      .getByRole('button', { name: '加入地图（1）', exact: true })
      .click();
    await page.getByText('已存 1 张', { exact: true }).waitFor();
    await page.locator('.photo-saved button').first().click();
    await page
      .getByRole('button', { name: '放大查看照片', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: '全屏照片', exact: true });
    await dialog.waitFor();
    await page.getByText(/海拔 501 m/).waitFor();
    await page.getByRole('button', { name: '放大照片', exact: true }).click();
    assert.equal(await page.getByLabel('照片缩放倍率').textContent(), '150%');
    // Real Chromium touch input verifies pinch-to-zoom, not just button zoom.
    await page.getByRole('button', { name: '适应屏幕', exact: true }).click();
    const stage = await page.getByLabel('照片缩放画布').boundingBox();
    const cdp = await context.newCDPSession(page),
      x = stage.x + stage.width / 2,
      y = stage.y + stage.height / 2;
    const touch = (a, b) => [
      { x: x + a, y, id: 1 },
      { x: x + b, y, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: touch(-30, 30),
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: touch(-65, 65),
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    assert.ok(
      parseInt(await page.getByLabel('照片缩放倍率').textContent()) >= 190,
    );
    await page.getByRole('button', { name: '适应屏幕', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('照片标题', { exact: true }).fill('山口云层');
    await page
      .getByLabel('照片备注', { exact: true })
      .fill('风从山谷吹来，记录云层边缘。');
    await page.getByRole('button', { name: '旋转90°', exact: true }).click();
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByRole('button', { name: '标记', exact: true }).click();
    const plane = await page.locator('.photo-image-plane').boundingBox();
    await page.mouse.move(
      plane.x + plane.width * 0.3,
      plane.y + plane.height * 0.4,
    );
    await page.mouse.down();
    await page.mouse.move(
      plane.x + plane.width * 0.7,
      plane.y + plane.height * 0.65,
      { steps: 12 },
    );
    await page.mouse.up();
    await page.getByText('1/80 笔', { exact: true }).waitFor();
    await page.mouse.click(
      plane.x + plane.width * 0.5,
      plane.y + plane.height * 0.5,
    );
    assert.equal(await page.locator('.photo-image-plane circle').count(), 1);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await page.locator('.photo-image-plane circle').count(), 0);
    await page.screenshot({
      path: `artifacts/screenshots/photo-ink-${width}-${height}.png`,
    });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await page.getByRole('button', { name: '详细信息', exact: true }).click();
    await page.getByText(/拍摄天气暂不可用/).waitFor();
    weatherFailure = false;
    await page
      .getByRole('button', { name: '重新查询拍摄天气', exact: true })
      .click();
    await page
      .getByText('Open-Meteo 近期模型天气 · 非现场实测', { exact: true })
      .waitFor();
    await page.screenshot({
      path: `artifacts/screenshots/photo-info-${width}-${height}.png`,
    });
    await page
      .getByRole('button', { name: '返回照片查看', exact: true })
      .click();
    await page.getByRole('button', { name: '分享', exact: true }).click();
    await page
      .getByRole('button', { name: '生成分享图片', exact: true })
      .click();
    await page.getByAltText('待分享图片预览', { exact: true }).waitFor();
    await page.screenshot({
      path: `artifacts/screenshots/photo-share-${width}-${height}.png`,
    });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '保存图片', exact: true }).click();
    const downloaded = await download;
    await downloaded.saveAs(`artifacts/screenshots/photo-export-${width}.jpg`);
    // Mock only the platform share endpoint; actual generation and file content are real.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'canShare', {
        configurable: true,
        value: () => true,
      });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async ({ files }) => {
          window.__sharedPhoto = { type: files[0].type, bytes: files[0].size };
        },
      });
    });
    await page.getByRole('button', { name: '分享图片', exact: true }).click();
    assert.ok((await page.evaluate(() => window.__sharedPhoto)).bytes > 1000);
    await page
      .getByRole('button', { name: '返回照片查看', exact: true })
      .click();
    await page
      .getByRole('button', { name: '退出照片全屏', exact: true })
      .click();
    await page
      .getByRole('button', { name: '关闭照片预览', exact: true })
      .click();
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page.getByRole('button', { name: '照片', exact: true }).click();
    await page
      .locator('.photo-panel input[type=file]')
      .first()
      .setInputFiles('tests/fixtures/photos/timed.jpg');
    await page
      .getByRole('button', { name: '加入地图（1）', exact: true })
      .click();
    await page
      .getByText('已加入 1 张照片预览；同轨迹重复照片自动更新', { exact: true })
      .waitFor();
    const result = await page.evaluate(async () => {
      const { readPhotos, patchPhoto, writePhotos } =
        await import('/modules/photos/storage.ts');
      let [p] = await readPhotos();
      if (
        p.title !== '山口云层' ||
        p.strokes.length !== 1 ||
        p.rotation !== 90 ||
        p.altitude.metres !== 501 ||
        p.weather.temperature !== 18
      )
        throw new Error('Saved details did not survive reimport');
      await Promise.all([
        patchPhoto(p.id, { note: '并发编辑保留' }),
        patchPhoto(p.id, { weatherError: '并发更新' }),
      ]);
      [p] = await readPhotos();
      if (p.note !== '并发编辑保留')
        throw new Error('Concurrent update lost note');
      await writePhotos([{ ...p, id: 'temporary' }]);
      await writePhotos([], 'temporary');
      await patchPhoto('temporary', { note: 'late' });
      if ((await readPhotos()).length !== 1)
        throw new Error('Deleted photo resurrected');
      const canvas = document.createElement('canvas');
      canvas.width = 4096;
      canvas.height = 2048;
      canvas.getContext('2d').fillRect(0, 0, 4096, 2048);
      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg'),
      );
      const { readPhoto } = await import('/modules/photos/import.ts');
      const large = await readPhoto(
        new File([blob], 'large.jpg', { type: 'image/jpeg' }),
      );
      const b = await createImageBitmap(large.detail);
      const dimensions = [b.width, b.height];
      b.close();
      return { dimensions };
    });
    assert.deepEqual(result.dimensions, [2560, 1280]);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__map);
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page.getByRole('button', { name: '照片', exact: true }).click();
    await page.locator('.photo-saved button').first().click();
    await page
      .getByRole('button', { name: '放大查看照片', exact: true })
      .click();
    await page.getByText('山口云层', { exact: true }).last().waitFor();
    assert.equal(await page.locator('.photo-image-plane polyline').count(), 1);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    const box = await dialog.boundingBox();
    assert.ok(box.width <= width + 1 && box.height <= height + 1);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        width,
        height,
        checks:
          'real import, pinch zoom, editing, rotated ink, weather failure/retry, JPEG export/download, share boundary, reimport/reload, atomic updates, high resolution, mobile layout',
      }),
    );
    await context.close();
  }
} finally {
  clearTimeout(timer);
  await browser.close();
}
