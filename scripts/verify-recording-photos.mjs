import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { browserRuntime } from './browser-runtime.mjs';

const { chromium } = browserRuntime();
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.GUANYUN_BROWSER ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const timer = setTimeout(() => {
  console.error('Browser verification timed out');
  process.exit(2);
}, 150000);
await mkdir('artifacts/screenshots', { recursive: true });
try {
  for (const [width, height] of [
    [390, 844],
    [360, 780],
  ]) {
    const native = width === 390;
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      timezoneId: 'Asia/Shanghai',
    });
    const page = await context.newPage();
    const errors = [];
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
    await page.addInitScript(
      ({ native }) => {
        if (!localStorage.getItem('record-photo-seeded')) {
          const time = Date.UTC(2026, 8, 7, 2);
          const fix = (time, lng) => ({
            coordinates: [lng, 30.659],
            time,
            accuracy: 5,
            altitude: 500,
          });
          localStorage.setItem(
            'guanyun.recording.v1',
            JSON.stringify({
              id: 'real-record',
              phase: 'finished',
              startedAt: time,
              error: '',
              segments: [[fix(time, 104.066), fix(time + 60000, 104.0661)]],
            }),
          );
          localStorage.setItem(
            'guanyun.manual-tracks.v1',
            JSON.stringify([
              {
                id: 'manual',
                name: '旧手绘',
                createdAt: time,
                segments: [
                  [
                    [104.066, 30.659],
                    [104.0661, 30.659],
                  ],
                ],
              },
            ]),
          );
          localStorage.setItem('record-photo-seeded', 'yes');
        }
        if (native)
          window.GuanyunNative = {
            recordState: () => localStorage.getItem('guanyun.recording.v1'),
            photoFolders: () => true,
            saveFile() {},
            record(action) {
              if (action === 'clear')
                localStorage.setItem(
                  'guanyun.recording.v1',
                  JSON.stringify({
                    id: '',
                    phase: 'idle',
                    startedAt: 0,
                    segments: [],
                    error: '',
                  }),
                );
            },
          };
      },
      { native },
    );
    await page.goto('http://localhost:3000/#16/30.659/104.066/-24/50', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => !!window.__map);
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page.getByRole('button', { name: '保存到轨迹', exact: true }).click();
    const choice = page.getByLabel('照片匹配轨迹', { exact: true });
    await assert.doesNotReject(() => choice.waitFor());
    assert.equal(await choice.inputValue(), 'real-record');
    const original = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('guanyun.manual-tracks.v1')).find(
        (t) => t.id === 'real-record',
      ),
    );
    assert.equal(original.source, 'recorded');
    assert.equal(
      original.samples[0][1].time - original.samples[0][0].time,
      60000,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__map);
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page.getByRole('button', { name: '照片', exact: true }).click();
    assert.equal(await choice.inputValue(), 'real-record');
    assert.match(await choice.textContent(), /实走轨迹/);
    const folder = page.getByLabel('选择照片文件夹', { exact: true });
    assert.equal(await folder.isDisabled(), false);
    await page.screenshot({
      path: `artifacts/screenshots/recording-photo-picker-${width}-${height}.png`,
    });
    if (native) {
      assert.equal(
        await folder.getAttribute('accept'),
        'application/x-guanyun-photo-folder',
      );
      await page
        .locator('.photo-panel input[type=file]')
        .first()
        .setInputFiles('tests/fixtures/photos/timed.jpg');
      await page.getByText('可匹配 1 / 1 张', { exact: true }).waitFor();
    } else {
      assert.notEqual(await folder.getAttribute('webkitdirectory'), null);
      await folder.setInputFiles(resolve('tests/fixtures/photos'));
      await page.getByText('可匹配 2 / 3 张', { exact: true }).waitFor();
    }
    await page.screenshot({
      path: `artifacts/screenshots/recording-photos-${width}-${height}.png`,
    });
    await page
      .getByRole('button', {
        name: native ? '加入地图（1）' : '加入地图（2）',
        exact: true,
      })
      .click();
    await page
      .getByText(native ? '已存 1 张' : '已存 2 张', { exact: true })
      .waitFor();
    // Navigate through the real saved-track UI and save a drawing copy.
    await page.keyboard.press('Escape');
    if (
      !(await page
        .getByRole('button', { name: '轨迹管理', exact: true })
        .isVisible())
    )
      await page.getByLabel('路线', { exact: true }).click();
    await page.getByRole('button', { name: '轨迹管理', exact: true }).click();
    const row = page.locator('[data-track-id="real-record"]');
    assert.match(await row.textContent(), /实走轨迹/);
    assert.equal(
      await row
        .getByRole('button', { name: '调整节点', exact: true })
        .isDisabled(),
      true,
    );
    await row.getByRole('button', { name: '复制为手绘', exact: true }).click();
    // Drawing opens on the map. Return to track management without discarding the draft.
    await page.keyboard.press('Escape');
    if (
      !(await page
        .getByRole('button', { name: '轨迹管理', exact: true })
        .isVisible())
    )
      await page.getByLabel('路线', { exact: true }).click();
    await page.getByRole('button', { name: '轨迹管理', exact: true }).click();
    await page.getByRole('button', { name: '保存到本机', exact: true }).click();
    const after = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('guanyun.manual-tracks.v1')),
    );
    assert.deepEqual(
      after.find((t) => t.id === 'real-record'),
      original,
    );
    assert.ok(
      after.some((t) => t.source === 'manual' && /手绘副本/.test(t.name)),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `artifacts/screenshots/recording-preserved-${width}-${height}.png`,
    });
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}x${height}: ${native ? 'native bridge' : 'web'} save/reload, timestamps, photo import, ${native ? 'native folder intent marker' : 'real folder import'}, immutable original and drawing copy`,
    );
    await context.close();
  }
} finally {
  clearTimeout(timer);
  await browser.close();
}
