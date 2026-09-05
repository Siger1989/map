// Requires a running local dev server. Browser diagnostics stay in this isolated context.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd(),
  artifacts = path.join(root, 'artifacts/screenshots');
await mkdir(artifacts, { recursive: true });
const timeout = setTimeout(() => {
  console.error('Browser verification exceeded 150s');
  process.exit(1);
}, 150000);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MAP_BROWSER_PATH || undefined,
  timeout: 20000,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1180, height: 850 },
    deviceScaleFactor: 1,
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.route('**/modules/map/TerrainMap.tsx*', async (route) => {
    const response = await route.fetch(),
      body = await response.text();
    assert.ok(
      body.includes('mapRef.current = map'),
      'development map instrumentation anchor',
    );
    await route.fulfill({
      response,
      body: body.replace(
        'mapRef.current = map',
        'window.__sectionTestMap = map; mapRef.current = map',
      ),
    });
  });
  await page.goto('http://localhost:3000/#8.53/30.9517/103.5591/-24/65', {
    waitUntil: 'domcontentloaded',
    timeout: 20000,
  });
  await page.waitForFunction(
    () => window.__sectionTestMap?.isStyleLoaded(),
    null,
    { timeout: 25000 },
  );
  const waitForSection = async () => {
    // Source.loaded() can briefly be true before setTiles starts worker requests.
    // Wait for the section's completed report and both rendered sources as well.
    await page.waitForFunction(
      () => {
        const m = window.__sectionTestMap;
        const status = document.querySelector(
          '.section-caption [role="status"]',
        )?.textContent;
        return (
          status?.startsWith('当前视野') &&
          m.isSourceLoaded('section-elevation') &&
          m.isSourceLoaded('section-cut-edges')
        );
      },
      null,
      { timeout: 25000 },
    );
  };
  const setHeight = async (height) => {
    const before = await page.evaluate(
      () => window.__sectionTestMap.getSource('section-elevation').tiles[0],
    );
    const changed =
      Number(await page.locator('#section-height-number').inputValue()) !==
      height;
    await page.locator('#section-height-number').fill(String(height));
    await page.locator('#section-height-number').press('Tab');
    await page.waitForFunction(
      ({ before, changed }) => {
        const m = window.__sectionTestMap;
        return (
          (!changed || m.getSource('section-elevation').tiles[0] !== before) &&
          m.isSourceLoaded('section-elevation')
        );
      },
      { before, changed },
      { timeout: 25000 },
    );
    await waitForSection();
  };
  const setColor = async (color) => {
    await page.getByLabel('剖面颜色', { exact: true }).evaluate((el, color) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set.call(el, color);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, color);
  };
  const pixels = async (color, region) =>
    page.evaluate(
      ({ color, region }) =>
        new Promise((resolve, reject) => {
          const fail = setTimeout(
              () => reject(new Error('No map render within 5s')),
              5000,
            ),
            m = window.__sectionTestMap;
          const old = m.getCanvas().getContext('webgl2').getError();
          m.once('render', () => {
            clearTimeout(fail);
            const gl = m.getCanvas().getContext('webgl2'),
              w = gl.drawingBufferWidth,
              h = gl.drawingBufferHeight,
              data = new Uint8Array(w * h * 4);
            gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
            const rgb = [1, 3, 5].map((i) =>
              parseInt(color.slice(i, i + 2), 16),
            );
            let matches = 0;
            for (let i = 0; i < data.length; i += 4)
              if (rgb.every((value, j) => Math.abs(data[i + j] - value) < 6))
                matches++;
            let interiorMatches = 0,
              interiorSamples = 0;
            if (region) {
              for (let y = region[1]; y < region[1] + region[3]; y++)
                for (let x = region[0]; x < region[0] + region[2]; x++) {
                  const i = ((h - y - 1) * w + x) * 4;
                  interiorSamples++;
                  if (
                    rgb.every((value, j) => Math.abs(data[i + j] - value) < 6)
                  )
                    interiorMatches++;
                }
            }
            resolve({
              matches,
              interiorMatches,
              interiorSamples,
              total: w * h,
              previousError: old,
              glError: gl.getError(),
              pitch: m.getPitch(),
              rttSize: m.painter.renderToTexture?.rttSize,
            });
          });
          m.triggerRepaint();
        }),
      { color, region },
    );
  const record = async (name, color, region) => {
    const stats = await pixels(color, region);
    await page.screenshot({
      path: path.join(artifacts, `${name}-20260906.png`),
    });
    console.log(JSON.stringify({ name, ...stats }));
    assert.equal(stats.previousError, 0, `${name}: accumulated WebGL error`);
    assert.equal(stats.glError, 0, `${name}: WebGL error`);
    assert.equal(
      stats.rttSize,
      1024,
      `${name}: matching terrain RTT dimensions`,
    );
    assert.ok(
      stats.matches > stats.total * 0.015,
      `${name}: real cut pixels must be visible`,
    );
    if (region)
      assert.ok(
        stats.interiorMatches > stats.interiorSamples * 0.995,
        `${name}: flat cap must have no transparent tile seam`,
      );
    return stats;
  };
  await page.getByRole('button', { name: '海拔剖面', exact: true }).click();
  await setHeight(2000);
  // This interior patch previously contained a diagonal transparent tile seam.
  const white = await record(
    'section-fixed-white',
    '#ffffff',
    [160, 390, 140, 34],
  );
  assert.equal(white.pitch, 65);
  const revision = await page.evaluate(
    () => window.__sectionTestMap.getSource('section-elevation').tiles[0],
  );
  await setColor('#63c9dd');
  await record('section-fixed-color', '#63c9dd');
  assert.equal(
    await page.evaluate(
      () => window.__sectionTestMap.getSource('section-elevation').tiles[0],
    ),
    revision,
    'recolor must not reload DEM',
  );
  await setHeight(4000);
  await record('section-fixed-height4000', '#63c9dd');
  await page.evaluate(() =>
    window.__sectionTestMap.jumpTo({
      center: [103.28, 31.08],
      zoom: 11,
      pitch: 55,
      bearing: 25,
    }),
  );
  await setHeight(3000);
  await setColor('#ffffff');
  await record('section-fixed-rotated', '#ffffff');
  await page.getByRole('button', { name: '退出剖面', exact: true }).click();
  assert.equal(
    await page.evaluate(() => window.__sectionTestMap.getTerrain().source),
    'elevation',
  );
  assert.equal(await page.locator('.section-slider').count(), 0);
  await page.getByRole('button', { name: '海拔剖面', exact: true }).click();
  await setHeight(3000);
  await record('section-fixed-reopened', '#ffffff');
  await page.setViewportSize({ width: 430, height: 780 });
  await waitForSection();
  await record('section-fixed-mobile', '#ffffff');
  const box = await page.locator('.section-slider').boundingBox();
  assert.ok(
    box.x >= 0 && box.x + box.width <= 430 && box.y + box.height <= 780,
  );
  assert.deepEqual(pageErrors, []);
  console.log(
    'PASS: actual cut pixels, color, altitude, rotation, repeated open/close, mobile bounds, WebGL',
  );
} finally {
  clearTimeout(timeout);
  await browser.close();
}
