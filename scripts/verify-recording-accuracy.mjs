import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserRuntime } from './browser-runtime.mjs';
const { chromium } = browserRuntime();
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.GUANYUN_BROWSER ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const timer = setTimeout(() => process.exit(2), 120000);
await mkdir('artifacts/screenshots', { recursive: true });
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
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.addInitScript(
      ({ native }) => {
        if (native) {
          window.GuanyunNative = {
            recordState: () =>
              JSON.stringify({
                id: '',
                phase: 'idle',
                startedAt: 0,
                segments: [],
                error: '',
              }),
            record() {},
            saveFile() {},
            recordingAccuracy: () =>
              Number(localStorage.getItem('native-test-accuracy') ?? 20),
            setRecordingAccuracy(value) {
              localStorage.setItem('native-test-accuracy', String(value));
              return true;
            },
          };
        } else {
          Object.defineProperty(navigator, 'geolocation', {
            value: {
              watchPosition(callback) {
                window.__fix = callback;
                return 1;
              },
              clearWatch() {},
            },
          });
        }
      },
      { native },
    );
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
    const open = async () => {
      await page.waitForFunction(() => !!window.__map);
      await page.getByRole('button', { name: '行程', exact: true }).click();
      await page.locator('.recording-precision summary').click();
    };
    await page.goto('http://localhost:3000/', {
      waitUntil: 'domcontentloaded',
    });
    await open();
    const input = page.getByLabel('允许记录的最大估计误差（米）');
    assert.equal(await input.inputValue(), '20');
    await input.fill('4');
    await page
      .getByRole('button', { name: '应用精度设置', exact: true })
      .click();
    await page
      .getByText('请输入5到80之间的整数（米）', { exact: true })
      .waitFor();
    await page.getByRole('button', { name: '恢复20米', exact: true }).click();
    assert.equal(await input.inputValue(), '20');
    await input.fill('10');
    await page
      .getByRole('button', { name: '应用精度设置', exact: true })
      .click();
    assert.match(
      await page.locator('.recording-precision summary').textContent(),
      /≤10/,
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    assert.equal(await input.inputValue(), '10');
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: `artifacts/screenshots/recording-accuracy-${width}-${height}.png`,
    });
    await page.locator('.recording-precision summary').click();
    if (!native) {
      await page.getByRole('button', { name: '开始记录', exact: true }).click();
      await page.waitForFunction(() => !!window.__fix);
      const send = async (accuracy, longitude) =>
        page.evaluate(
          ({ accuracy, longitude }) =>
            window.__fix({
              timestamp: Date.now(),
              coords: { longitude, latitude: 30.659, accuracy, altitude: 500 },
            }),
          { accuracy, longitude },
        );
      await send(30, 104.066);
      await page.getByText(/当前估计误差 30 米.*该点未记录/).waitFor();
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem('guanyun.recording.v1'),
            ).segments.flat().length,
        ),
        0,
      );
      await send(8, 104.066);
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem('guanyun.recording.v1'),
            ).segments.flat().length,
        ),
        1,
      );
      await page.locator('.recording-precision summary').click();
      await input.fill('50');
      await page
        .getByRole('button', { name: '应用精度设置', exact: true })
        .click();
      await page.locator('.recording-precision summary').click();
      await page.waitForTimeout(1000); // Ensure the next measured fix has a later timestamp.
      await send(30, 104.0661);
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(
              localStorage.getItem('guanyun.recording.v1'),
            ).segments.flat().length,
        ),
        2,
      );
      await page.getByRole('button', { name: '结束记录', exact: true }).click();
    }
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}x${height}: ${native ? 'native preference bridge' : 'web fixes'}, defaults, validation, persistent setting${native ? '' : ', rejected/coarse and accepted fixes, live threshold change'}`,
    );
    await context.close();
  }
} finally {
  clearTimeout(timer);
  await browser.close();
}
