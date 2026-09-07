// Isolated synthetic annotations; never touches the user's open browser or saved data.
import { browserRuntime } from './browser-runtime.mjs';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
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
        body: (await response.text()).replace(
          'mapRef.current = map',
          'window.__map = map; mapRef.current = map',
        ),
      });
    });
    await page.goto('http://localhost:3000/#13/31.08/103.28/-24/65', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () => window.__map?.getLayer('annotation-models'),
      null,
      { timeout: 40000 },
    );
    await page.waitForFunction(
      () => window.__map.queryTerrainElevation([103.28, 31.08]) > 100,
      null,
      { timeout: 40000 },
    );
    await page.evaluate(() => {
      const ground = window.__map.queryTerrainElevation([103.28, 31.08]) ?? 0;
      const item = {
        id: 'qa-box',
        kind: 'box',
        name: '测试营地',
        note: '',
        color: '#f2b45f',
        coordinates: [103.28, 31.08],
        groundElevation: ground,
        placement: 'surface',
        offset: 120,
        width: 150,
        length: 200,
        height: 180,
        heading: 25,
        pitch: 12,
        roll: 8,
        opacity: 0.55,
        visible: true,
      };
      localStorage.setItem('guanyun.annotations.v1', JSON.stringify([item]));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        window.__map?.getLayer('annotation-models')?.implementation
          ?.hasRendered,
      null,
      { timeout: 40000 },
    );
    const read = () =>
      page.evaluate(() => {
        const layer = window.__map.getLayer('annotation-models').implementation;
        const frame = layer.frames.get('qa-box'),
          mesh = frame.children[0].children[0];
        const vertices = mesh.geometry.attributes.position;
        let top = Infinity;
        for (let i = 0; i < vertices.count; i++) {
          const point = mesh.position
            .clone()
            .fromBufferAttribute(vertices, i)
            .applyMatrix4(mesh.matrixWorld)
            .applyMatrix4(layer.camera.projectionMatrix);
          top = Math.min(top, ((1 - point.y) * innerHeight) / 2);
        }
        const marker = layer.markers.get('qa-box'),
          rect = marker.getElement().getBoundingClientRect();
        return {
          gap: top - rect.bottom,
          rect: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          },
          offset: marker.getOffset(),
          coordinates: marker.getLngLat().toArray(),
          saved: JSON.parse(localStorage.getItem('guanyun.annotations.v1'))[0],
          pitch: window.__map.getPitch(),
          bearing: window.__map.getBearing(),
        };
      });
    const checkGap = async () => {
      // Allow DOM marker and custom WebGL layer to finish the same animation frame.
      await page.waitForFunction(() => !window.__map.isMoving());
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      const data = await read();
      assert.ok(Math.abs(data.gap - 6) < 0.5, JSON.stringify(data));
      assert.equal(
        await page
          .locator('[data-annotation-id="qa-box"]')
          .evaluate((el) => getComputedStyle(el).opacity),
        '1',
      );
      assert.deepEqual(data.coordinates, data.saved.coordinates);
      return data;
    };
    await checkGap();
    assert.ok(await page.locator('.camera-gizmo').isVisible());
    const modelControl = page.getByRole('slider', {
      name: '俯仰角度，上下拖动绿色模型',
      exact: true,
    });
    const ring = page.getByRole('slider', {
      name: '旋转视角，沿圆环滑动',
      exact: true,
    });
    await modelControl.press('ArrowUp');
    assert.ok((await checkGap()).pitch > 65);
    await ring.press('ArrowRight');
    assert.ok((await checkGap()).bearing > -24);
    const modelBox = await modelControl.boundingBox();
    await page.mouse.move(
      modelBox.x + modelBox.width / 2,
      modelBox.y + modelBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      modelBox.x + modelBox.width / 2,
      modelBox.y + modelBox.height / 2 + 15,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.ok((await checkGap()).pitch < 70);
    await page.getByRole('button', { name: '工具', exact: true }).click();
    assert.equal(
      await page.getByRole('button', { name: '视角盘', exact: true }).count(),
      0,
    );
    assert.ok(await page.locator('.camera-gizmo').isVisible());
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    await page.getByRole('button', { name: '图层', exact: true }).click();
    const layerBox = await page.locator('#map-layer-window').boundingBox();
    const gizmoBox = await page.locator('.camera-gizmo').boundingBox();
    assert.ok(layerBox.y + layerBox.height < gizmoBox.y);
    await page
      .getByRole('button', { name: '关闭图层窗口', exact: true })
      .click();
    for (const view of [
      { pitch: 0, bearing: 0, zoom: 12.5 },
      { pitch: 65, bearing: 90, zoom: 13.5 },
      { pitch: 65, bearing: -24, zoom: 13 },
    ]) {
      await page.evaluate((view) => window.__map.jumpTo(view), view);
      await checkGap();
    }
    const before = await read();
    const label = page.getByRole('button', {
      name: '编辑标记 测试营地',
      exact: true,
    });
    await label.click();
    await page.locator('.annotation-editor').waitFor();
    await page.getByRole('button', { name: '外观', exact: true }).click();
    await page.getByLabel('所在位置').selectOption('underground');
    await checkGap();
    await page.getByLabel('所在位置').selectOption('surface');
    await page.getByRole('button', { name: '关闭面板', exact: true }).click();
    const labelBox = await label.boundingBox();
    await page.mouse.move(
      labelBox.x + labelBox.width / 2,
      labelBox.y + labelBox.height / 2,
    );
    await page.mouse.down();
    await page.waitForFunction(() =>
      document.querySelector('.feature-drag-active'),
    );
    await page.mouse.move(
      labelBox.x + labelBox.width / 2 + 18,
      labelBox.y + labelBox.height / 2 + 12,
      { steps: 5 },
    );
    await page.mouse.up();
    await page.waitForFunction(
      () =>
        window.__map
          .getLayer('annotation-models')
          .implementation.frames.has('qa-box'),
      null,
      { timeout: 20000 },
    );
    const after = await checkGap();
    assert.notDeepEqual(after.saved.coordinates, before.saved.coordinates);
    assert.equal(after.saved.width, before.saved.width);
    assert.equal(after.saved.offset, before.saved.offset);
    await page.getByRole('button', { name: '完成调整', exact: true }).click();
    await page.evaluate(
      (center) => window.__map.jumpTo({ center }),
      after.saved.coordinates,
    );
    await checkGap();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.ok(await modelControl.isVisible());
    await page.screenshot({
      path: `artifacts/screenshots/model-label-camera-${width}.png`,
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        result: 'PASS',
        width,
        height,
        checks:
          '6px model silhouette gap, zoom/pitch/bearing, underground/surface, label selection and saved drag, persistent camera, keyboard/pointer controls, layer panel no occlusion, no overflow/errors',
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}
