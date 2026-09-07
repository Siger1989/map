// Isolated synthetic GPS/roads. No changes to the user's open preview or stored routes.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserRuntime } from './browser-runtime.mjs';
import { metresBetween } from '../modules/navigation/types.ts';
const origin = [103.275, 31.08],
  end = [103.285, 31.08];
const mainLine = [origin, [103.28, 31.08], end];
const payloadFor = (points) => {
  const distance = points
    .slice(1)
    .reduce((sum, p, i) => sum + metresBetween(points[i], p), 0);
  return {
    code: 'Ok',
    waypoints: [points[0], points.at(-1)].map((location) => ({ location })),
    routes: [
      {
        geometry: { type: 'LineString', coordinates: points },
        distance,
        duration: distance / 1.4,
        legs: [
          {
            steps: [
              {
                distance,
                duration: distance / 1.4,
                geometry: { coordinates: points },
                maneuver: { type: 'depart' },
              },
              {
                distance: 0,
                duration: 0,
                geometry: { coordinates: [points.at(-1)] },
                maneuver: { type: 'arrive' },
              },
            ],
          },
        ],
      },
    ],
  };
};
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
    await context.addInitScript(
      ({ origin }) => {
        const realNow = Date.now,
          base = realNow();
        let offset = 0,
          id = 0;
        Date.now = () => realNow() + offset;
        window.__watches = new Map();
        window.__denied = false;
        window.__position = {
          coords: { longitude: origin[0], latitude: origin[1], accuracy: 5 },
          timestamp: base,
        };
        window.__gps = (x, y, seconds = 5, accuracy = 5) => {
          offset += seconds * 1000;
          window.__position = {
            coords: { longitude: x, latitude: y, accuracy },
            timestamp: Date.now(),
          };
          for (const cb of window.__watches.values())
            cb.success(window.__position);
        };
        Object.defineProperty(navigator, 'geolocation', {
          value: {
            watchPosition(success, error) {
              const key = ++id;
              window.__watches.set(key, { success, error });
              setTimeout(() => {
                if (window.__watches.has(key)) {
                  if (window.__denied) error({ code: 1 });
                  else success({ ...window.__position, timestamp: Date.now() });
                }
              }, 20);
              return key;
            },
            clearWatch(key) {
              window.__watches.delete(key);
            },
          },
        });
      },
      { origin },
    );
    const page = await context.newPage(),
      errors = [],
      requests = [];
    let backend = 'okay',
      release = null;
    page.setDefaultTimeout(20000);
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/modules/map/TerrainMap.tsx*', async (r) => {
      const response = await r.fetch();
      await r.fulfill({
        response,
        body: (await response.text()).replace(
          'mapRef.current = map',
          'window.__map = map; mapRef.current = map',
        ),
      });
    });
    await page.route('https://photon.komoot.io/api/**', (r) => {
      const q = new URL(r.request().url()).searchParams.get('q'),
        name = q?.includes('起点') ? '测试起点' : '测试终点';
      return r.fulfill({
        json: {
          features: [
            {
              geometry: { coordinates: name === '测试起点' ? origin : end },
              properties: { name, city: '测试路线' },
            },
          ],
        },
      });
    });
    await page.route(
      'https://valhalla1.openstreetmap.de/route**',
      async (r) => {
        const payload = JSON.parse(
          new URL(r.request().url()).searchParams.get('json'),
        );
        requests.push(payload);
        const points = payload.locations.map((p) => [p.lon, p.lat]);
        const planning =
          metresBetween(points[0], origin) < 1 &&
          metresBetween(points.at(-1), end) < 1;
        if (!planning && backend === 'error') {
          await r.fulfill({ status: 503, body: 'unavailable' });
          return;
        }
        if (!planning && backend === 'hold')
          await new Promise((resolve) => {
            release = resolve;
          });
        const line = planning
          ? mainLine
          : [
              points[0],
              [points[0][0] + 0.0002, points[0][1]],
              [points.at(-1)[0] + 0.0002, points.at(-1)[1]],
              points.at(-1),
            ];
        try {
          await r.fulfill({ json: payloadFor(line) });
        } catch {
          /* A canceled request must remain canceled. */
        }
      },
    );
    await page.goto('http://localhost:3000/#13/31.08/103.28/0/0', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => window.__map?.getLayer('annotation-models'),
      null,
      { timeout: 45000 },
    );
    await page.getByRole('button', { name: '路线', exact: true }).click();
    await page.getByRole('button', { name: '步行', exact: true }).click();
    for (const [label, name] of [
      ['起点', '测试起点'],
      ['终点', '测试终点'],
    ]) {
      await page.getByRole('textbox', { name: label, exact: true }).fill(name);
      await page
        .getByRole('button', { name: new RegExp(name + '.*测试路线') })
        .click();
    }
    await page.getByRole('button', { name: '规划路线', exact: true }).click();
    await page.locator('.route-start-notice').waitFor();
    assert.equal(requests.length, 1);
    await page.evaluate(() => {
      window.__denied = true;
    });
    await page
      .locator('.route-start-notice')
      .getByRole('button', { name: '开始导航' })
      .click();
    await page
      .locator('.guidance-card')
      .getByText(/定位权限未允许/)
      .waitFor();
    assert.equal(await page.evaluate(() => window.__watches.size), 0);
    await page.evaluate(() => {
      window.__denied = false;
    });
    await page
      .locator('.guidance-card')
      .getByRole('button', { name: /当前位置|恢复跟随/ })
      .click();
    await page.locator('.guidance-card[data-status="on-route"]').waitFor();
    assert.equal(
      await page.getByTestId('guidance-travelled').innerText(),
      '0 米',
    );
    const gps = async (x, y, seconds = 5, accuracy = 5) => {
      await page.evaluate(
        ({ x, y, seconds, accuracy }) => window.__gps(x, y, seconds, accuracy),
        { x, y, seconds, accuracy },
      );
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    const overlay = () =>
      page.evaluate(() => window.__map.getSource('route-guidance').getData());
    const original = await page.evaluate(
      async () =>
        (await window.__map.getSource('planned-route').getData()).features.find(
          (f) => f.geometry.type === 'LineString',
        ).geometry.coordinates,
    );
    await gps(103.276, 31.08, 20);
    await page.waitForFunction(
      () =>
        parseInt(
          document.querySelector('[data-testid="guidance-travelled"]')
            .textContent,
        ) > 80,
    );
    const walked = await page.getByTestId('guidance-travelled').innerText();
    await gps(103.28, 31.082, 5, 150);
    await page
      .locator('.guidance-card')
      .getByText(/等待更准确定位/)
      .waitFor();
    assert.equal(
      await page.getByTestId('guidance-travelled').innerText(),
      walked,
    );
    assert.equal(requests.length, 1);
    assert.deepEqual(
      await page.evaluate(
        async () =>
          (
            await window.__map.getSource('current-position').getData()
          ).features.find((f) => f.geometry.type === 'Point').geometry
            .coordinates,
      ),
      [103.276, 31.08],
    );
    await gps(103.276, 31.08, 5);
    await page.locator('.guidance-card[data-status="on-route"]').waitFor();
    await page.screenshot({
      path: `artifacts/screenshots/guidance-progress-${width}.png`,
    });
    await gps(103.276, 31.0807, 10);
    await page
      .locator('.guidance-card')
      .getByText('可能偏离，正在确认…')
      .waitFor();
    assert.equal(requests.length, 1);
    await gps(103.276, 31.0807, 4);
    await page
      .locator('.guidance-card')
      .getByText('沿橙线接回原路线')
      .waitFor();
    assert.equal(requests.length, 2);
    assert.equal(requests[1].costing, 'pedestrian');
    const returned = await overlay();
    assert.equal(returned.features.length, 2);
    assert.ok(
      metresBetween(
        returned.features[1].geometry.coordinates,
        [103.276, 31.08],
      ) < 1,
    );
    assert.deepEqual(
      await page.evaluate(
        async () =>
          (
            await window.__map.getSource('planned-route').getData()
          ).features.find((f) => f.geometry.type === 'LineString').geometry
            .coordinates,
      ),
      original,
    );
    await page
      .locator('.guidance-card')
      .getByRole('button', { name: '看接回路线' })
      .click();
    await page.waitForFunction(() => !window.__map.isMoving());
    const layout = await page.locator('.guidance-card').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        right: r.right,
        y: r.y,
        bottom: r.bottom,
        height: r.height,
        buttons: [...el.querySelectorAll('button')].map((b) => ({
          width: b.offsetWidth,
          height: b.offsetHeight,
        })),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.ok(
      layout.x >= 0 &&
        layout.right < width - 48 &&
        layout.height <= Math.min(320, height * 0.38),
    );
    assert.ok(layout.buttons.every((b) => b.width >= 44 && b.height >= 44));
    assert.equal(layout.overflow, false);
    const gizmo = await page
      .getByRole('slider', { name: '俯仰角度，上下拖动绿色模型' })
      .boundingBox();
    assert.ok(gizmo.y > layout.bottom);
    await page.screenshot({
      path: `artifacts/screenshots/guidance-rejoin-${width}.png`,
    });
    // Follow the return path, then regain the original route without replacing it.
    await gps(103.2762, 31.0807, 6);
    await gps(103.2762, 31.08, 12);
    await page.locator('.guidance-card').getByText('沿原路线导航').waitFor();
    await page.waitForFunction(
      async () =>
        (await window.__map.getSource('route-guidance').getData()).features
          .length === 0,
    );
    const preserved = await page.getByTestId('guidance-travelled').innerText();
    assert.notEqual(preserved, '0 米');
    // An offline deviation requests no route. Reconnection retries the real planning adapter.
    await context.setOffline(true);
    await gps(103.277, 31.081, 40);
    await gps(103.277, 31.081, 4);
    await page
      .locator('.guidance-card')
      .getByText(/网络已断开/)
      .waitFor();
    const offlineCount = requests.length;
    backend = 'error';
    await context.setOffline(false);
    await page
      .locator('.guidance-card .guidance-error[role="alert"]')
      .waitFor();
    assert.equal(requests.length, offlineCount + 1);
    assert.equal((await overlay()).features.length, 0);
    backend = 'okay';
    await page
      .locator('.guidance-card')
      .getByRole('button', { name: '重新计算', exact: true })
      .click();
    await page
      .locator('.guidance-card')
      .getByText('沿橙线接回原路线')
      .waitFor();
    // A response from a now-distant location is discarded even while still off route.
    backend = 'hold';
    await gps(103.279, 31.0825, 40);
    await gps(103.279, 31.0825, 4);
    await page
      .locator('.guidance-card')
      .getByText('正在计算接回路线…')
      .waitFor();
    await page.waitForResponse(() => false, { timeout: 100 }).catch(() => {});
    assert.ok(release);
    await gps(103.282, 31.084, 40);
    release();
    release = null;
    await page
      .locator('.guidance-card')
      .getByText('位置已变化，等待重新计算接回路线。')
      .waitFor();
    assert.equal((await overlay()).features.length, 0);
    // A late response after returning to the main route is also discarded.
    await page
      .locator('.guidance-card')
      .getByRole('button', { name: '重新计算', exact: true })
      .click();
    await page
      .locator('.guidance-card')
      .getByText('正在计算接回路线…')
      .waitFor();
    await page.waitForResponse(() => false, { timeout: 100 }).catch(() => {});
    assert.ok(release);
    await gps(103.282, 31.08, 40);
    release();
    release = null;
    await page.locator('.guidance-card').getByText('沿原路线导航').waitFor();
    assert.equal((await overlay()).features.length, 0);
    await page.getByRole('button', { name: '结束导航', exact: true }).click();
    await page.locator('.guidance-card').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__watches.size), 0);
    // Finishing a route keeps the walked summary until explicit exit.
    await page
      .getByRole('button', { name: '跟随当前位置', exact: true })
      .click();
    await page.waitForFunction(() => window.__watches.size > 0);
    await page
      .locator('.route-start-notice')
      .getByRole('button', { name: '开始导航' })
      .click();
    await page.locator('.guidance-card').waitFor();
    await page.getByRole('button', { name: '结束导航', exact: true }).click();
    await page.locator('.guidance-card').waitFor({ state: 'detached' });
    assert.ok(await page.evaluate(() => window.__watches.size > 0));
    await page
      .getByRole('button', { name: '更多地图操作', exact: true })
      .click();
    await page
      .getByRole('button', { name: '停止持续定位', exact: true })
      .click();
    await page
      .getByRole('button', { name: '更多地图操作', exact: true })
      .click();
    assert.equal(await page.evaluate(() => window.__watches.size), 0);
    backend = 'okay';
    await gps(end[0], end[1], 60);
    await page
      .locator('.route-start-notice')
      .getByRole('button', { name: '开始导航' })
      .click();
    await page.locator('.guidance-card').waitFor();
    await gps(end[0], end[1], 4);
    await page.locator('.guidance-card[data-status="arrived"]').waitFor();
    assert.equal(
      await page.getByTestId('guidance-remaining').innerText(),
      '0 米',
    );
    await page.getByRole('button', { name: '结束导航', exact: true }).click();
    // Editing the plan automatically stops its active session and owned location watcher.
    await gps(origin[0], origin[1], 60);
    await page
      .locator('.route-start-notice')
      .getByRole('button', { name: '开始导航' })
      .click();
    await page.locator('.guidance-card').waitFor();
    await page.getByRole('button', { name: '路线', exact: true }).click();
    await page.getByRole('button', { name: '骑行', exact: true }).click();
    await page.locator('.guidance-card').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.__watches.size), 0);
    assert.equal((await overlay()).features.length, 0);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        width,
        height,
        checks:
          'plan/start, denied permission recovery, filtered walked distance, two-fix deviation, road rejoin and unchanged original, route return, network failure/retry, late response cancellation, arrival, plan change/stop watcher cleanup, 44px controls and no overlap/overflow',
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
