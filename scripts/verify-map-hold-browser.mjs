// Synthetic markers in isolated contexts; the user's preview and saved data remain untouched.
import { browserRuntime } from './browser-runtime.mjs';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const java = await readFile(
  'mobile/android/src/com/guanyun/weather/MainActivity.java',
  'utf8',
);
const back = JSON.parse(
  java.match(/evaluateJavascript\(("(?:\\.|[^"\\])*"), result/)[1],
);
const browser = await browserRuntime().chromium.launch({
  headless: true,
  executablePath:
    process.env.MAP_BROWSER_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
try {
  await mkdir('artifacts/screenshots', { recursive: true });
  for (const [width, height] of [
    [390, 844],
    [360, 780],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/modules/map/TerrainMap.tsx*', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: (await response.text())
          .replace(
            'mapRef.current = map',
            'window.__map = map; mapRef.current = map',
          )
          .replace(
            'longPressRef.current = new MapLongPress',
            'window.__hold = longPressRef.current = new MapLongPress',
          ),
      });
    });
    await page.goto('http://localhost:3000/#13/31.08/103.28/0/0', {
      waitUntil: 'domcontentloaded',
    });
    const ready = () =>
      page.waitForFunction(
        () => window.__map?.getLayer('annotation-models'),
        null,
        { timeout: 40000 },
      );
    await ready();
    await page.waitForFunction(
      () => window.__map.queryTerrainElevation([103.28, 31.08]) > 100,
      null,
      { timeout: 40000 },
    );
    const saved = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem('guanyun.annotations.v1') || '[]'),
      );
    const x = 140,
      y = Math.round(height * 0.42);
    let attempt = 0;
    const open = async (px = x, py = y) => {
      attempt++;
      await page.waitForFunction(() => !window.__map.isMoving());
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.mouse.move(px, py);
      await page.evaluate(() => {
        window.__moves = [];
        window.__map.once('movestart', () => window.__moves.push('movestart'));
      });
      await page.mouse.down();
      try {
        await page.waitForFunction(() =>
          document.querySelector('.map-hold-ready'),
        );
      } catch (error) {
        console.log(
          'Hold diagnostics',
          await page.evaluate(
            ({ px, py, attempt }) => ({
              target: document
                .elementFromPoint(px, py)
                ?.outerHTML.slice(0, 180),
              pending: window.__hold.pending,
              contacts: [...window.__hold.contacts],
              enabled: window.__hold.options.enabled(),
              occupied: window.__hold.options.occupied({ x: px, y: py }),
              moving: window.__map.isMoving(),
              ground: window.__hold.ground({ x: px, y: py }),
              unproject: window.__map.unproject([px, py]).toArray(),
              project: window.__map.project(
                window.__map.unproject([px, py]).toArray(),
              ),
              moves: window.__moves,
              attempt,
            }),
            { px, py, attempt },
          ),
        );
        throw error;
      }
      assert.equal(await page.locator('.quick-add-card').count(), 0);
      await page.mouse.up();
      await page.locator('.quick-add-card').waitFor();
    };
    await open();
    const layout = await page.evaluate(() => {
      const card = document
        .querySelector('.quick-add-card')
        .getBoundingClientRect();
      const gizmo = document
        .querySelector('[aria-label="俯仰角度，上下拖动绿色模型"]')
        .getBoundingClientRect();
      return {
        x: card.x,
        y: card.y,
        right: card.right,
        bottom: card.bottom,
        height: card.height,
        gizmoY: gizmo.y,
        targets: [...document.querySelectorAll('.quick-add-card button')].map(
          (b) => ({ width: b.offsetWidth, height: b.offsetHeight }),
        ),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(layout.overflow, false);
    assert.ok(
      layout.x >= 0 && layout.right <= width && layout.bottom < layout.gizmoY,
    );
    assert.ok(layout.height <= Math.min(320, height * 0.38));
    assert.ok(layout.targets.every((b) => b.width >= 44 && b.height >= 44));
    assert.equal(await page.locator('.control-dock.is-expanded').count(), 0);
    await page.screenshot({
      path: `artifacts/screenshots/map-hold-${width}.png`,
    });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.quick-add-card').count(), 0);
    assert.deepEqual(await saved(), []);
    await open();
    assert.equal(await page.evaluate(back), true);
    await page.locator('.quick-add-card').waitFor({ state: 'detached' });
    await open();
    await page
      .getByRole('button', { name: '取消添加标记', exact: true })
      .click();
    await open();
    await page.mouse.click(width - 65, height * 0.65);
    await page.locator('.quick-add-card').waitFor({ state: 'detached' });
    // A short tap and a native pan cannot create a marker.
    await page.mouse.click(x, y);
    const beforePan = await page.evaluate(() =>
      window.__map.getCenter().toArray(),
    );
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 25, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => !window.__map.isMoving());
    assert.notDeepEqual(
      await page.evaluate(() => window.__map.getCenter().toArray()),
      beforePan,
    );
    assert.deepEqual(await saved(), []);
    assert.equal(await page.locator('.quick-add-card').count(), 0);
    // Real Chromium touch events, including two-finger cancellation and a successful hold.
    const cdp = await context.newCDPSession(page);
    const point = (id, px, py) => ({
      id,
      x: px,
      y: py,
      radiusX: 2,
      radiusY: 2,
      force: 1,
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(1, x, y)],
    });
    await page.waitForFunction(() => document.querySelector('.map-hold-ready'));
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(1, x, y), point(2, x + 40, y)],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(1, x - 10, y), point(2, x + 50, y)],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.waitForFunction(() => !window.__map.isMoving());
    assert.equal(await page.locator('.quick-add-card').count(), 0);
    assert.deepEqual(await saved(), []);
    const coordinate = await page.evaluate(
      ({ x, y }) => window.__map.unproject([x, y]).toArray(),
      { x, y },
    );
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(1, x, y)],
    });
    await page.waitForFunction(() => document.querySelector('.map-hold-ready'));
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.locator('.quick-add-card').waitFor();
    await page.getByRole('button', { name: '地点标记', exact: true }).click();
    await page.locator('.quick-add-card').waitFor({ state: 'detached' });
    const initial = (await saved())[0];
    assert.equal((await saved()).length, 1);
    assert.ok(
      initial.coordinates.every((v, i) => Math.abs(v - coordinate[i]) < 1e-8),
    );
    assert.equal(initial.kind, 'pin');
    // Long-hold the saved pin and release elsewhere. Preview must not write storage.
    const label = page.getByRole('button', {
      name: '编辑标记 地点标记',
      exact: true,
    });
    await label.waitFor();
    const rect = await label.boundingBox(),
      cx = rect.x + rect.width / 2,
      cy = rect.y + rect.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.waitForFunction(() =>
      document.querySelector('.feature-drag-active'),
    );
    assert.equal(await page.locator('.quick-add-card').count(), 0);
    await page.mouse.move(cx + 24, cy + 18, { steps: 5 });
    assert.deepEqual((await saved())[0].coordinates, initial.coordinates);
    await page.mouse.up();
    await page.waitForFunction(
      (before) =>
        JSON.parse(
          localStorage.getItem('guanyun.annotations.v1'),
        )[0].coordinates.some((v, i) => v !== before[i]),
      initial.coordinates,
    );
    const moved = (await saved())[0];
    assert.equal(moved.id, initial.id);
    assert.equal(moved.name, initial.name);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual((await saved())[0].coordinates, initial.coordinates);
    const touchRect = await label.boundingBox();
    const tx = touchRect.x + touchRect.width / 2,
      ty = touchRect.y + touchRect.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [point(1, tx, ty)],
    });
    await page.waitForFunction(() =>
      document.querySelector('.feature-drag-active'),
    );
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [point(1, tx + 20, ty + 14)],
    });
    assert.deepEqual((await saved())[0].coordinates, initial.coordinates);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.waitForFunction(
      (before) =>
        JSON.parse(
          localStorage.getItem('guanyun.annotations.v1'),
        )[0].coordinates.some((v, i) => v !== before[i]),
      initial.coordinates,
    );
    assert.equal(await page.locator('.quick-add-card').count(), 0);
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    assert.deepEqual((await saved())[0].coordinates, initial.coordinates);
    await page.getByRole('button', { name: '完成调整', exact: true }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    assert.deepEqual((await saved())[0].coordinates, initial.coordinates);
    // Outside map movement closes the card; a quota error keeps the card open without phantom data.
    await open(70, Math.round(height * 0.65));
    await page.evaluate(() => window.__map.panBy([4, 0], { duration: 0 }));
    await page.locator('.quick-add-card').waitFor({ state: 'detached' });
    await open(70, Math.round(height * 0.65));
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      window.__restoreStorage = () => {
        Storage.prototype.setItem = original;
      };
      Storage.prototype.setItem = function (k, v) {
        if (k === 'guanyun.annotations.v1')
          throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, k, v);
      };
    });
    await page.getByRole('button', { name: '长方体', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '修改尚未保存' }).waitFor();
    assert.equal((await saved()).length, 1);
    assert.equal(await page.locator('.quick-add-card').count(), 1);
    await page.evaluate(() => window.__restoreStorage());
    await page.getByRole('button', { name: '长方体', exact: true }).click();
    await page.locator('.quick-add-card').waitFor({ state: 'detached' });
    assert.equal((await saved())[1].kind, 'box');
    assert.equal((await saved()).length, 2);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        width,
        height,
        checks:
          '44px targets, compact card no overflow/occlusion, direct pin/model creation, exact coordinate, cancel/Escape/native back/outside/pan, real touch hold and multi-touch cancellation, mouse/touch saved-marker drag/preview/undo/reload, quota recovery',
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
