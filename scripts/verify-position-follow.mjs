import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {
  chromium,
} = require('C:/Users/sigeryang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const timer = setTimeout(() => process.exit(2), 150000);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
try {
  for (const [width, height, native] of [
    [390, 844, false],
    [360, 780, true],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(
      ({ native }) => {
        const callbacks = new Map();
        let seq = 0;
        window.__watchCount = 0;
        Object.defineProperty(navigator, 'geolocation', {
          value: {
            watchPosition(cb) {
              callbacks.set(++seq, cb);
              window.__watchCount++;
              return seq;
            },
            clearWatch(id) {
              callbacks.delete(id);
            },
          },
        });
        window.__emitLive = (lng, lat) => {
          for (const cb of callbacks.values())
            cb({
              coords: {
                longitude: lng,
                latitude: lat,
                accuracy: 5,
                altitude: 500,
              },
              timestamp: Date.now(),
            });
        };
        let state = {
          id: '',
          phase: 'idle',
          startedAt: 0,
          segments: [],
          error: '',
        };
        if (native)
          window.GuanyunNative = {
            recordState: () => JSON.stringify(state),
            saveFile() {},
            record(action) {
              if (action === 'start')
                state = {
                  id: 'native-test',
                  phase: 'recording',
                  startedAt: Date.now(),
                  segments: [[]],
                  error: '',
                };
              if (action === 'pause') state.phase = 'paused';
              if (action === 'resume') {
                state.phase = 'recording';
                state.segments.push([]);
              }
              if (action === 'finish') state.phase = 'finished';
            },
          };
        window.__emit = (lng, lat, age = 0) => {
          if (native)
            state.segments.at(-1).push({
              coordinates: [lng, lat],
              accuracy: 5,
              altitude: 500,
              time: Date.now() - age,
            });
          else window.__emitLive(lng, lat);
        };
      },
      { native },
    );
    await page.route('**/modules/map/TerrainMap.tsx*', async (route) => {
      const r = await route.fetch();
      await route.fulfill({
        response: r,
        body: (await r.text()).replace(
          'mapRef.current = map',
          'window.__map = map; window.__followCalls=0; const oldEase=map.easeTo.bind(map); map.easeTo=(a,b)=>{if(b?.positionFollow)window.__followCalls++; return oldEase(a,b);}; mapRef.current = map',
        ),
      });
    });
    await page.goto('http://localhost:3000/#14/30.659/104.066/-24/50', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForFunction(() => window.__map?.isStyleLoaded(), null, {
      timeout: 35000,
    });
    const center = () =>
      page.evaluate(() => window.__map.getCenter().toArray());
    const reaches = async (lng, lat) =>
      page.waitForFunction(
        ([x, y]) => {
          const m = window.__map,
            c = m.getCenter();
          return (
            !m.isMoving() &&
            Math.abs(c.lng - x) < 0.00001 &&
            Math.abs(c.lat - y) < 0.00001
          );
        },
        [lng, lat],
        { timeout: 10000 },
      );
    const emit = async (lng, lat, age = 0) =>
      page.evaluate(([x, y, a]) => window.__emit(x, y, a), [lng, lat, age]);
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page.getByRole('button', { name: '开始记录', exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.location-button')
          ?.getAttribute('aria-pressed') === 'true',
    );
    await emit(104.066, 30.659);
    await page.waitForFunction(() => window.__followCalls > 0);
    await reaches(104.066, 30.659);
    await page.getByRole('button', { name: '行程', exact: true }).click();
    const initial = await page.evaluate(() => ({
      zoom: window.__map.getZoom(),
      pitch: window.__map.getPitch(),
      bearing: window.__map.getBearing(),
    }));
    await emit(104.06615, 30.659);
    await reaches(104.06615, 30.659);
    const calls = await page.evaluate(() => window.__followCalls);
    await page.waitForTimeout(1750);
    assert.equal(
      await page.evaluate(() => window.__followCalls),
      calls,
      'repeated checkpoints do not restart animation',
    );
    const cdp = await context.newCDPSession(page);
    const touch = async (type, x, y) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ id: 0, x, y }],
      });
    await touch('touchStart', width * 0.5, height * 0.57);
    for (let i = 1; i <= 10; i++)
      await touch('touchMove', width * 0.5 + 5 * i, height * 0.57 + 2 * i);
    await touch('touchEnd');
    await page.waitForFunction(
      () =>
        document
          .querySelector('.location-button')
          ?.getAttribute('aria-pressed') === 'false',
    );
    await page.waitForFunction(() => !window.__map.isMoving());
    const browsed = await center();
    await emit(104.0663, 30.659);
    await page.waitForTimeout(2000);
    assert.deepEqual(
      await center(),
      browsed,
      'manual browsing is not pulled back by recording',
    );
    await page
      .getByRole('button', { name: '跟随当前位置', exact: true })
      .click();
    await reaches(104.0663, 30.659);
    assert.equal(
      await page.evaluate(() => window.__watchCount),
      native ? 0 : 1,
      'recording follow reuses its source',
    );
    const camera = await page.evaluate(() => ({
      zoom: window.__map.getZoom(),
      pitch: window.__map.getPitch(),
      bearing: window.__map.getBearing(),
    }));
    for (const key of Object.keys(initial))
      assert.ok(
        Math.abs(camera[key] - initial[key]) < 0.001,
        `${key} preserved`,
      );
    if (native) {
      await emit(104.08, 30.66, 30000);
      await page
        .getByRole('button', { name: '等待定位，点击暂停跟随', exact: true })
        .waitFor();
      const staleCenter = await center();
      assert.ok(
        Math.abs(staleCenter[0] - 104.0663) < 1e-8 &&
          Math.abs(staleCenter[1] - 30.659) < 1e-8,
      );
      await emit(104.06645, 30.659);
      await reaches(104.06645, 30.659);
    }
    await page
      .getByRole('button', { name: '更多地图操作', exact: true })
      .click();
    await page.getByRole('button', { name: '放大地图', exact: true }).click();
    await page.waitForFunction(() => !window.__map.isMoving());
    const zoomed = await page.evaluate(() => window.__map.getZoom());
    await page
      .getByRole('button', { name: '跟随手机方向', exact: true })
      .click();
    await page.evaluate(() => {
      let alpha = 0;
      window.__compassTimer = setInterval(
        () =>
          window.dispatchEvent(
            new DeviceOrientationEvent('deviceorientationabsolute', {
              alpha: (alpha += 2),
              beta: 0,
              gamma: 0,
              absolute: true,
            }),
          ),
        110,
      );
    });
    await page.waitForFunction(
      () => Math.abs(window.__map.getBearing() + 24) > 2,
    );
    await emit(104.06655, 30.659);
    await reaches(104.06655, 30.659);
    assert.ok(
      Math.abs((await page.evaluate(() => window.__map.getZoom())) - zoomed) <
        0.001,
    );
    await page.evaluate(() => clearInterval(window.__compassTimer));
    await page
      .getByRole('button', { name: '跟随手机方向', exact: true })
      .click();
    await page
      .getByRole('button', { name: '更多地图操作', exact: true })
      .click();
    await page.screenshot({
      path: `artifacts/screenshots/follow-${native ? 'native' : 'web'}-${width}-${height}.png`,
    });
    assert.equal(await page.locator('.camera-gizmo').isVisible(), true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page.getByRole('button', { name: '暂停', exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.location-button')
          ?.getAttribute('aria-pressed') === 'false',
    );
    await page.getByRole('button', { name: '继续记录', exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.location-button')
          ?.getAttribute('aria-pressed') === 'true',
    );
    await emit(104.0666, 30.659);
    await reaches(104.0666, 30.659);
    await page.getByRole('button', { name: '结束记录', exact: true }).click();
    await page.waitForFunction(
      () =>
        document
          .querySelector('.location-button')
          ?.getAttribute('aria-pressed') === 'false',
    );
    await page.getByRole('button', { name: '行程', exact: true }).click();
    await page
      .getByRole('button', { name: '跟随当前位置', exact: true })
      .click();
    await page.evaluate(() => window.__emitLive(104.0668, 30.659));
    await reaches(104.0668, 30.659);
    await page.evaluate(() => window.__emitLive(104.067, 30.659));
    await reaches(104.067, 30.659);
    await page
      .getByRole('button', { name: '暂停位置跟随', exact: true })
      .click();
    assert.equal(
      await page.locator('.location-button').getAttribute('aria-pressed'),
      'false',
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        width,
        height,
        native,
        result: 'PASS',
        checks:
          'recording auto follow, repeated fixes, touch browse, resume, camera preservation, zoom and concurrent compass, stale native fixes, pause/resume/end, ordinary location follow, no extra recording watch, controller and layout',
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
  clearTimeout(timer);
}
