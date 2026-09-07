import { browserRuntime } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
import { verifyPreviewCamera } from './camera-gesture-checks.mjs';
import {
  installRailPositionMock,
  verifyRailPreviewLayout,
  verifyRailPositionProgress,
} from './rail-progress-checks.mjs';
const { chromium } = browserRuntime();
const timer = setTimeout(() => process.exit(2), 180000),
  browser = await chromium.launch({
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
      }),
      page = await context.newPage(),
      errors = [];
    let payload;
    page.on('pageerror', (e) => errors.push(String(e)));
    // A saved visible plane must not keep the app in section editing mode.
    await page.addInitScript(() => {
      if (!localStorage.getItem('shantu.section-object.v1'))
        localStorage.setItem(
          'shantu.section-object.v1',
          JSON.stringify({
            enabled: true,
            altitude: 2000,
            color: '#ffffff',
            plane: {
              center: [105, 32],
              width: 1000,
              height: 1000,
              heading: 0,
              tilt: 0,
            },
          }),
        );
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
    const places = {
      天府广场: [104.066, 30.659],
      锦里: [104.045, 30.641],
      龙泉驿: [104.27, 30.56],
    };
    await page.route('https://photon.komoot.io/api/**', async (route) => {
      const q = new URL(route.request().url()).searchParams.get('q');
      await route.fulfill({
        json: {
          features: places[q]
            ? [
                {
                  geometry: { coordinates: places[q] },
                  properties: { name: q, city: '成都' },
                },
              ]
            : [],
        },
      });
    });
    await page.route(
      'https://valhalla1.openstreetmap.de/route**',
      async (route) => {
        payload = JSON.parse(
          new URL(route.request().url()).searchParams.get('json'),
        );
        const points = payload.locations.map((p) => [p.lon, p.lat]);
        await route.fulfill({
          json: {
            code: 'Ok',
            waypoints: points.map((location) => ({ location })),
            routes: [
              {
                geometry: { type: 'LineString', coordinates: points },
                distance: 24000,
                duration: 3600,
                legs: points.slice(1).map((p, i) => ({
                  steps: [
                    {
                      distance: 12000,
                      duration: 1800,
                      geometry: { coordinates: [points[i], p] },
                      maneuver: { type: 'depart' },
                    },
                    {
                      distance: 0,
                      duration: 0,
                      geometry: { coordinates: [p] },
                      maneuver: { type: 'arrive' },
                    },
                  ],
                })),
              },
            ],
          },
        });
      },
    );
    await page.route(
      'https://api.open-meteo.com/v1/forecast**',
      async (route) => {
        const count = new URL(route.request().url()).searchParams
            .get('latitude')
            .split(',').length,
          base = Math.floor(Date.now() / 3600000) * 3600;
        const data = Array.from({ length: count }, (_, i) => ({
          hourly: {
            time: Array.from({ length: 168 }, (_, j) => base + j * 3600),
            temperature_2m: Array(168).fill(20 + i),
            precipitation: Array(168).fill(i / 2),
            wind_speed_10m: Array(168).fill(3),
            weather_code: Array(168).fill(0),
          },
        }));
        await route.fulfill({ json: count === 1 ? data[0] : data });
      },
    );
    await page.goto('http://localhost:3000/#12/30.65/104.07/0/0', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(() => window.__map?.isStyleLoaded(), null, {
      timeout: 30000,
    });
    await page.getByRole('button', { name: '路线', exact: true }).click();
    await page
      .getByRole('button', { name: '在地图选择起点', exact: true })
      .click();
    await page.getByRole('button', { name: '矩形剖面', exact: true }).click();
    assert.equal(
      await page.locator('.observatory').getAttribute('data-picking-route'),
      'false',
    );
    await page
      .getByRole('button', { name: '关闭剖面详情', exact: true })
      .click();
    await page
      .getByRole('button', { name: '结束对象操作', exact: true })
      .click();
    assert.equal(
      await page.evaluate(
        () =>
          window.__map.getLayer('section-plane').implementation.settings
            .enabled,
      ),
      true,
    );
    await page.getByRole('button', { name: '路线', exact: true }).click();
    await page
      .getByRole('button', { name: '在地图选择起点', exact: true })
      .click();
    await page
      .locator('.maplibregl-canvas')
      .click({ position: { x: width / 2, y: height / 2 } });
    await page.getByRole('textbox', { name: '起点', exact: true }).waitFor();
    assert.ok(
      (
        await page
          .getByRole('textbox', { name: '起点', exact: true })
          .inputValue()
      ).startsWith('地图选点'),
    );
    async function fill(label, name) {
      await page.getByRole('textbox', { name: label, exact: true }).fill(name);
      await page
        .getByRole('button', { name: new RegExp(name + '.*成都') })
        .click({ timeout: 12000 });
    }
    await fill('起点', '天府广场');
    await fill('终点', '龙泉驿');
    await page.getByRole('button', { name: '途经点', exact: true }).click();
    await fill('途经点 1', '锦里');
    await page.screenshot({
      path: `artifacts/screenshots/route-input-${width}-${height}.png`,
    });
    const from = await page
        .getByRole('button', { name: '拖动排序途经点 1', exact: true })
        .boundingBox(),
      to = await page
        .getByRole('button', { name: '拖动排序起点', exact: true })
        .boundingBox();
    const cdp = await context.newCDPSession(page),
      touch = async (type, x, y) =>
        cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
        });
    await touch('touchStart', from.x + 20, from.y + 22);
    await touch('touchMove', to.x + 20, to.y + 22);
    await touch('touchEnd', 0, 0);
    assert.equal(
      await page
        .getByRole('textbox', { name: '起点', exact: true })
        .inputValue(),
      '锦里',
    );
    assert.equal(
      await page
        .getByRole('textbox', { name: '途经点 1', exact: true })
        .inputValue(),
      '天府广场',
    );
    await page
      .getByRole('button', { name: '规划路线 · 1 个途经点', exact: true })
      .click();
    await page.getByRole('slider', { name: '拖动浏览行程' }).waitFor();
    assert.deepEqual(
      payload.locations.map((p) => [p.lon, p.lat]),
      [places['锦里'], places['天府广场'], places['龙泉驿']],
    );
    const slider = page.getByRole('slider', { name: '拖动浏览行程' }),
      box = await slider.boundingBox();
    assert.equal(box.width, 44);
    assert.ok(box.height > 300);
    assert.match(
      await page.locator('.rail-end').first().textContent(),
      /^终点/,
    );
    assert.match(await page.locator('.rail-end').last().textContent(), /^起点/);
    assert.equal(await page.locator('.rail-distance').textContent(), '— km');
    await touch('touchStart', box.x + 22, box.y + box.height * 0.85);
    for (let i = 2; i <= 8; i++) {
      await touch('touchMove', box.x + 22, box.y + box.height * (1 - i / 10));
      await page.waitForTimeout(30);
    }
    await touch('touchEnd', 0, 0);
    await page.waitForTimeout(600);
    const percent = Number(await slider.getAttribute('aria-valuenow'));
    assert.ok(Math.abs(percent - 80) < 1);
    assert.equal(await page.locator('.route-preview-cursor').count(), 1);
    assert.ok(
      await page.getByText('预览 19.2 公里', { exact: true }).isVisible(),
    );
    await page.screenshot({
      path: `artifacts/screenshots/route-scrub-${width}-${height}.png`,
    });
    await verifyRailPreviewLayout(page, width);
    await verifyPreviewCamera(page, context, width);
    await slider.focus();
    await slider.press('End');
    assert.equal(Number(await slider.getAttribute('aria-valuenow')), 100);
    await slider.press('Home');
    assert.equal(Number(await slider.getAttribute('aria-valuenow')), 0);
    await slider.press('ArrowUp');
    assert.equal(Number(await slider.getAttribute('aria-valuenow')), 1);
    await slider.press('Shift+ArrowUp');
    assert.equal(Number(await slider.getAttribute('aria-valuenow')), 11);
    await slider.press('ArrowDown');
    assert.equal(Number(await slider.getAttribute('aria-valuenow')), 10);
    await page
      .getByRole('button', { name: '关闭行程预览', exact: true })
      .click();
    assert.equal(await page.locator('.route-preview-cursor').count(), 0);
    // Following exits the preview; a new scrub pauses following again.
    await installRailPositionMock(page);
    await slider.press('End');
    await page
      .getByRole('button', { name: '跟随当前位置', exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.location-button')
          ?.getAttribute('aria-pressed') === 'true',
    );
    assert.equal(await page.locator('.route-preview-cursor').count(), 0);
    assert.equal(
      await page
        .getByRole('button', { name: '关闭行程预览', exact: true })
        .count(),
      0,
    );
    await verifyRailPositionProgress(page, width);
    assert.equal(
      await page.locator('.observatory').getAttribute('data-section'),
      'false',
    );
    await page.getByRole('button', { name: '开始导航', exact: true }).click();
    await page.getByRole('region', { name: '路线导航', exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          window.__map.getLayer('section-plane').implementation.settings
            .enabled,
      ),
      true,
    );
    await page.getByRole('button', { name: '结束导航', exact: true }).click();
    await slider.waitFor();
    await slider.press('End');
    await page.waitForFunction(
      () =>
        document
          .querySelector('.location-button')
          ?.getAttribute('aria-pressed') === 'false',
    );
    assert.equal(await page.locator('.route-preview-cursor').count(), 1);
    await page
      .getByRole('button', { name: '关闭行程预览', exact: true })
      .click();
    await page.getByRole('button', { name: '路线', exact: true }).click();
    await page.getByRole('button', { name: '收藏路线', exact: true }).click();
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('guanyun.route-favorites.v1'))[0]
            .route.stops.length,
      ),
      3,
    );
    await page.getByRole('button', { name: '清除', exact: true }).click();
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    // Restore via the saved route's real button.
    const saved = page.getByRole('button', { name: /锦里.*龙泉驿/ }).first();
    await saved.click();
    await page.getByRole('button', { name: '路线', exact: true }).click();
    assert.equal(
      await page
        .getByRole('textbox', { name: '途经点 1', exact: true })
        .inputValue(),
      '天府广场',
    );
    // The delete action is visible without focusing the waypoint input.
    const removeVia = page.getByRole('button', {
      name: '删除途经点 1',
      exact: true,
    });
    await removeVia.scrollIntoViewIfNeeded();
    assert.equal(await page.locator('.stop-edit-options').count(), 0);
    assert.equal(await page.locator('.stop-remove').count(), 1);
    const removeBox = await removeVia.boundingBox();
    assert.ok(removeBox.width >= 44 && removeBox.height >= 44);
    assert.ok(removeBox.x >= 0 && removeBox.x + removeBox.width <= width);
    await page.screenshot({
      path: `artifacts/screenshots/route-waypoint-delete-${width}.png`,
    });
    await removeVia.tap();
    assert.equal(await page.locator('[data-stop-id]').count(), 2);
    assert.equal(await page.locator('.stop-remove').count(), 0);
    assert.equal(
      await page
        .getByRole('textbox', { name: '起点', exact: true })
        .inputValue(),
      '锦里',
    );
    assert.equal(
      await page
        .getByRole('textbox', { name: '终点', exact: true })
        .inputValue(),
      '龙泉驿',
    );
    assert.equal(await page.locator('.route-start-notice').count(), 0);
    assert.equal(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('guanyun.route-favorites.v1'))[0]
            .route.stops.length,
      ),
      3,
    );
    // Newly added empty waypoints can also be removed after their editor is closed.
    await page.getByRole('button', { name: '途经点', exact: true }).click();
    await page
      .getByRole('button', { name: '完成编辑途经点 1', exact: true })
      .click();
    await removeVia.tap();
    assert.equal(await page.locator('[data-stop-id]').count(), 2);
    await page.setViewportSize({ width, height: 460 });
    await page.getByRole('textbox', { name: '起点', exact: true }).fill('天府');
    await page
      .getByRole('textbox', { name: '起点', exact: true })
      .scrollIntoViewIfNeeded();
    const input = await page
      .getByRole('textbox', { name: '起点', exact: true })
      .boundingBox();
    assert.ok(input.y >= 0 && input.y + input.height < 460);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: `artifacts/screenshots/route-keyboard-${width}.png`,
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS',
      width,
      height,
      'direct inputs, map origin, touch reorder, request order, upward rail, inline km, automatic GPS progress, preview separation, invalid fixes, restore, visible waypoint delete, saved data retained, keyboard viewport',
    );
    await context.close();
  }
} finally {
  await browser.close();
  clearTimeout(timer);
}
