// Run against the existing local dev server; diagnostics stay in an isolated browser context.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const timeout = setTimeout(() => {
  console.error('Plane QA exceeded 180 seconds');
  process.exit(2);
}, 180000);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MAP_BROWSER_PATH,
  timeout: 20000,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1180, height: 850 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (
      m.type() === 'error' &&
      /WebGL|shader|framebuffer|INVALID_/i.test(m.text())
    )
      errors.push(m.text());
  });
  await page.route('**/modules/map/TerrainMap.tsx*', async (route) => {
    const r = await route.fetch(),
      body = await r.text();
    assert.ok(body.includes('mapRef.current = map'));
    await route.fulfill({
      response: r,
      body: body.replace(
        'mapRef.current = map',
        'window.__planeMap = map; mapRef.current = map',
      ),
    });
  });
  await page.goto('http://localhost:3000/#10.5/31.08/103.28/-24/65', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__planeMap?.isStyleLoaded(), null, {
    timeout: 35000,
  });
  await page.getByRole('button', { name: '矩形剖面', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('.section-caption')?.dataset.phase === 'ready',
    null,
    { timeout: 30000 },
  );
  const snapshot = () =>
    page.evaluate(() => {
      const m = window.__planeMap,
        l = m.getLayer('section-plane').implementation;
      return {
        settings: l.settings,
        side: l.side,
        matched: l.clip.matched,
        terrain: m.getTerrain(),
        face: l.face.geometry.attributes.position.count,
        phase: l.status.phase,
      };
    });
  const before = await snapshot();
  assert.equal(before.terrain.source, 'elevation');
  assert.ok(before.matched >= 2);
  assert.ok(before.face > 0);
  // Observe source replacements: changing plane and camera must never rewrite DEM tiles.
  await page.evaluate(() => {
    window.__setTilesCalls = 0;
    const source = window.__planeMap.getSource('elevation'),
      old = source.setTiles.bind(source);
    source.setTiles = (...args) => {
      window.__setTilesCalls++;
      return old(...args);
    };
  });
  await mkdir('artifacts/screenshots', { recursive: true });
  const shot = async (name) => {
    await page.screenshot({
      path: `artifacts/screenshots/free-plane-${name}-20260906.png`,
    });
    console.log('SCREENSHOT PASS', name);
  };
  // Count actual cap-coloured framebuffer pixels in the same render callback.
  const pixels = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          const m = window.__planeMap;
          m.once('render', () => {
            const gl = m.getCanvas().getContext('webgl2'),
              pixels = new Uint8Array(
                gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
              );
            gl.readPixels(
              0,
              0,
              gl.drawingBufferWidth,
              gl.drawingBufferHeight,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixels,
            );
            let white = 0,
              red = 0;
            for (let i = 0; i < pixels.length; i += 4) {
              if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245)
                white++;
              if (pixels[i] > 180 && pixels[i + 1] < 70 && pixels[i + 2] < 70)
                red++;
            }
            resolve({ white, red, error: gl.getError() });
          });
          m.triggerRepaint();
        }),
    );
  let counts = await pixels();
  assert.ok(counts.white > 10000, JSON.stringify(counts));
  assert.equal(counts.error, 0);
  await shot('front');
  const center = page.getByRole('button', {
    name: '拖动切面位置',
    exact: true,
  });
  let box = await center.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 55,
    box.y + box.height / 2 + 20,
    { steps: 12 },
  );
  await page.mouse.up();
  await page.waitForTimeout(300);
  const moved = await snapshot();
  assert.notDeepEqual(
    moved.settings.plane.center,
    before.settings.plane.center,
  );
  assert.equal(moved.settings.altitude, before.settings.altitude);
  console.log('PASS center drag');
  const corner = page.getByRole('button', {
    name: '拖动切面角点3缩放',
    exact: true,
  });
  box = await corner.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + 17, box.y + 17);
  await page.mouse.down();
  await page.mouse.move(box.x + 55, box.y - 20, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.notEqual(
    (await snapshot()).settings.plane.width,
    moved.settings.plane.width,
  );
  console.log('PASS corner resize');
  await page.getByRole('button', { name: '调整', exact: true }).click();
  const range = async (name, value) =>
    page.getByRole('slider', { name, exact: true }).evaluate((el, value) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      ).set.call(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  await range('切面倾斜', 35);
  await page.waitForTimeout(400);
  assert.equal((await snapshot()).settings.plane.tilt, 35);
  await shot('tilted');
  await range('切面面内旋转', 30);
  await page.waitForTimeout(250);
  assert.equal((await snapshot()).settings.plane.roll, 30);
  await shot('rolled');
  await range('切面面内旋转', 0);
  await page.getByRole('button', { name: '水平', exact: true }).click();
  await page.waitForTimeout(400);
  assert.equal((await snapshot()).settings.plane.tilt, 90);
  assert.ok((await pixels()).white > 1000);
  await shot('horizontal');
  await page.getByRole('button', { name: '竖直', exact: true }).click();
  await range('切面方位', 20);
  await page.waitForTimeout(300);
  const side = (await snapshot()).side;
  await page.evaluate(() => {
    const m = window.__planeMap;
    m.jumpTo({ bearing: m.getBearing() + 180 });
  });
  await page.waitForTimeout(600);
  assert.equal((await snapshot()).side, -side);
  await shot('back');
  await page.getByRole('button', { name: '尺寸', exact: true }).click();
  await page.getByLabel('剖面颜色', { exact: true }).evaluate((el) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(el, '#dd2222');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  counts = await pixels();
  assert.ok(counts.red > 1000, JSON.stringify(counts));
  assert.equal(counts.error, 0);
  await shot('color');
  for (const [width, height] of [
    [390, 844],
    [360, 780],
    [360, 460],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    const layout = await page.evaluate(() => {
      const panel = document
          .querySelector('.section-panel')
          .getBoundingClientRect(),
        actions = document
          .querySelector('.map-actions')
          .getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        panel: {
          x: panel.x,
          y: panel.y,
          right: panel.right,
          bottom: panel.bottom,
          height: panel.height,
        },
        actions: { x: actions.x, y: actions.y },
        bodyScroll:
          document.querySelector('.section-panel-body').scrollHeight >
          document.querySelector('.section-panel-body').clientHeight,
      };
    });
    assert.equal(layout.overflow, false);
    assert.ok(layout.panel.right < layout.actions.x);
    assert.ok(layout.panel.bottom < height);
    if (height > 500)
      assert.ok(layout.panel.height <= Math.min(height * 0.38, 320) + 1);
    await page.getByRole('button', { name: '位置', exact: true }).click();
    await page
      .getByRole('button', { name: '移到视野中心', exact: true })
      .click();
    await page.getByRole('button', { name: '角度', exact: true }).click();
    await range('切面倾斜', -20);
    await page.waitForTimeout(250);
    await shot(`mobile-${width}-${height}`);
    console.log('LAYOUT PASS', JSON.stringify({ width, height, ...layout }));
  }
  assert.equal(await page.evaluate(() => window.__setTilesCalls), 0);
  console.log('PASS zero DEM setTiles during manipulation');
  await page.getByRole('button', { name: '退出剖面', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await center.isVisible(), false);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: '矩形剖面', exact: true }).click();
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: '退出剖面', exact: true }).click();
  }
  assert.equal(
    (await page.evaluate(() => window.__planeMap.getTerrain())).source,
    'elevation',
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS exit/reopen, WebGL and runtime errors',
    JSON.stringify(errors),
  );
} finally {
  await browser.close();
  clearTimeout(timeout);
}
