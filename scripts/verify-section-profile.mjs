import { browserRuntime } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { verifySectionNotes } from './section-note-checks.mjs';
const browser = await browserRuntime().chromium.launch({
  headless: true,
  executablePath:
    process.env.MAP_BROWSER_PATH ||
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const timeout = setTimeout(() => {
  console.error('Section QA exceeded 420s');
  process.exit(2);
}, 420000);
await mkdir('artifacts/screenshots', { recursive: true });
try {
  for (const [width, height] of [
    [390, 844],
    [360, 780],
  ]) {
    const context = await browser.newContext({
        viewport: { width, height },
        hasTouch: true,
        acceptDownloads: true,
      }),
      page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (
        m.type() === 'error' &&
        /WebGL|shader|framebuffer|INVALID_/i.test(m.text())
      )
        errors.push(m.text());
    });
    // Deterministic 1000m DEM, using the real tile decoding/rendering pipeline.
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = 'rgb(131,232,0)';
      g.fillRect(0, 0, 256, 256);
      return c.toDataURL().split(',')[1];
    });
    await page.route('**/api/terrain/**', (r) =>
      r.fulfill({ contentType: 'image/png', body: Buffer.from(png, 'base64') }),
    );
    await page.route('**/modules/map/TerrainMap.tsx*', async (route) => {
      const r = await route.fetch();
      const body = await r.text();
      assert.ok(body.includes('mapRef.current = map'));
      await route.fulfill({
        response: r,
        body: body.replace(
          'mapRef.current = map',
          'window.__map = map; mapRef.current = map',
        ),
      });
    });
    await page.addInitScript(() => {
      if (!localStorage.getItem('guanyun.annotations.v1'))
        localStorage.setItem(
          'guanyun.annotations.v1',
          JSON.stringify([
            {
              id: 'profile-box',
              kind: 'box',
              name: '剖面验证模型',
              note: '',
              color: '#f2b45f',
              coordinates: [103.28, 31.08],
              groundElevation: 1000,
              placement: 'surface',
              offset: 0,
              width: 10,
              length: 10,
              height: 10,
              heading: 0,
              pitch: 0,
              roll: 0,
              opacity: 0.55,
              visible: true,
            },
          ]),
        );
      window.__writes = 0;
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === 'guanyun.annotations.v1') window.__writes++;
        return set.call(this, k, v);
      };
    });
    await page.goto('http://localhost:3000/#18/31.08/103.28/-24/55', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForFunction(
      () =>
        window.__map?.getLayer('section-plane') &&
        window.__map?.terrain?.getCoverageIndex?.()?.samplerPerTile.size > 0,
      null,
      { timeout: 35000 },
    );
    await page.getByRole('button', { name: '矩形剖面', exact: true }).click();
    await page
      .getByRole('button', { name: '查看对象详情', exact: true })
      .click();
    const profile = page.getByRole('dialog', { name: '剖面交线详情' });
    await profile
      .locator('summary')
      .filter({ hasText: '精确设置剖面' })
      .click();
    for (const [name, value] of [
      ['中心海拔 m', '1005'],
      ['宽 m', '40'],
      ['高 m', '40'],
      ['方向 °', '0'],
    ]) {
      const field = profile.getByRole('spinbutton', { name, exact: true });
      await field.fill(value);
      await field.press('Enter');
    }
    await profile
      .getByRole('combobox', { name: '选择交线' })
      .selectOption({ label: '剖面验证模型 · 1 · 模型' });
    await profile
      .locator('.section-profile-body')
      .evaluate((el) => (el.scrollTop = 0));
    const before = await profile.locator('output').innerText();
    await profile.getByRole('slider', { name: '沿交线查看点海拔' }).fill('400');
    await page.waitForTimeout(180);
    const after = await profile.locator('output').innerText();
    assert.notEqual(after, before);
    assert.match(after, /100\d\.\d+ m/);
    const readout = await page.evaluate(() => {
      const l = window.__map.getLayer('section-plane').implementation;
      return {
        point: Array.from(l.cursor.geometry.attributes.position.array),
        clips:
          window.__map.getLayer('annotation-models').implementation.freeSection,
        rim: l.rim.geometry.attributes.position.count,
      };
    });
    assert.equal(readout.clips, null);
    assert.equal(readout.point.length, 3);
    assert.ok(readout.rim > 0);
    await verifySectionNotes(page, profile, width);
    await page.getByRole('button', { name: '回到对象', exact: true }).click();
    await page.waitForFunction(() => !window.__map.isMoving());
    const downloadEvent = page.waitForEvent('download');
    await profile
      .getByRole('button', { name: '保存图片', exact: true })
      .click();
    const download = await downloadEvent;
    const imagePath = `artifacts/screenshots/section-export-${width}.jpg`;
    await download.saveAs(imagePath);
    const bytes = await readFile(imagePath);
    assert.equal(bytes[0], 255);
    assert.equal(bytes[1], 216);
    assert.ok(bytes.length > 50000);
    const dims = await page.evaluate(async (b64) => {
      const i = await createImageBitmap(
        await (await fetch('data:image/jpeg;base64,' + b64)).blob(),
      );
      const d = [i.width, i.height];
      i.close();
      return d;
    }, bytes.toString('base64'));
    assert.equal(dims[0], 1600);
    assert.ok(dims[1] > 1300);
    console.log('PASS profile, scrub, full model, image', width, dims, after);
    await page.screenshot({
      path: `artifacts/screenshots/section-profile-${width}.png`,
    });
    await profile.getByRole('button', { name: '关闭剖面详情' }).click();
    const layerState = () =>
      page.evaluate(
        () => window.__map.getLayer('section-plane').implementation.settings,
      );
    const initial = await layerState();
    const drag = async (name, dx, dy, cancel = false) => {
      const target = page.getByRole('button', { name, exact: true }),
        b = await target.boundingBox();
      assert.ok(b, name);
      const x = b.x + b.width / 2,
        y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 8 });
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
      await page.waitForTimeout(200);
    };
    await drag('沿X轴移动', 22, 6, true);
    assert.deepEqual(await layerState(), initial);
    await drag('沿X轴移动', 22, 6);
    assert.notDeepEqual(
      (await layerState()).plane.center,
      initial.plane.center,
    );
    await page.getByRole('button', { name: '撤销对象变换' }).click();
    assert.deepEqual(await layerState(), initial);
    await drag('沿X轴拉伸', 22, 8);
    assert.ok((await layerState()).plane.width > 40);
    await page.getByRole('button', { name: '撤销对象变换' }).click();
    // Rotation ring: select a real unobstructed arc point and dispatch real pointer motion.
    const rotation = page.getByRole('button', {
      name: '绕Z轴旋转',
      exact: true,
    });
    await rotation.focus();
    await rotation.press('ArrowRight');
    assert.notEqual((await layerState()).plane.heading, initial.plane.heading);
    await page.getByRole('button', { name: '撤销对象变换' }).click();
    await page.screenshot({
      path: `artifacts/screenshots/section-gizmo-${width}.png`,
    });
    // Click the actual plane where no projected gizmo handle is in front of it.
    const planeHit = await page.evaluate(() => {
      const layer = window.__map.getLayer('section-plane').implementation;
      for (let y = 250; y < innerHeight - 170; y += 3)
        for (let x = 20; x < innerWidth - 65; x += 3) {
          if (
            document.elementFromPoint(x, y)?.tagName === 'CANVAS' &&
            layer.pick({ x, y })
          )
            return { x, y };
        }
      return null;
    });
    assert.ok(planeHit, 'plane has a directly clickable surface');
    await page.mouse.click(planeHit.x, planeHit.y);
    assert.equal(await profile.count(), 1);
    await profile.getByRole('button', { name: '关闭剖面详情' }).click();
    await page.getByRole('button', { name: '结束对象操作' }).click();
    await page.getByRole('button', { name: '编辑标记 剖面验证模型' }).click();
    const stored = () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('guanyun.annotations.v1'))[0],
      );
    const modelBefore = await stored();
    await drag('沿X轴拉伸', 20, 5);
    const modelAfter = await stored();
    assert.ok(modelAfter.width > modelBefore.width);
    assert.equal(modelAfter.length, modelBefore.length);
    assert.ok(Number.isFinite(modelAfter.centerAltitude));
    await page.getByRole('button', { name: '撤销对象变换' }).click();
    assert.deepEqual(await stored(), modelBefore);
    // Actual touch input: preview must never write storage; release writes once.
    const cdp = await context.newCDPSession(page);
    let target = await page
      .getByRole('button', { name: '中心黄色方块等比缩放' })
      .boundingBox();
    let touch = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
      id: 1,
    };
    const writes = await page.evaluate(() => window.__writes);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touch],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...touch, x: touch.x + 25 }],
    });
    assert.deepEqual(await stored(), modelBefore);
    assert.equal(await page.evaluate(() => window.__writes), writes);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.waitForTimeout(160);
    assert.equal(await page.evaluate(() => window.__writes), writes + 1);
    assert.ok((await stored()).width > modelBefore.width);
    await page.getByRole('button', { name: '撤销对象变换' }).click();
    assert.deepEqual(await stored(), modelBefore);
    target = await page
      .getByRole('button', { name: '中心黄色方块等比缩放' })
      .boundingBox();
    touch = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
      id: 1,
    };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [touch],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...touch, x: touch.x + 20 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchCancel',
      touchPoints: [],
    });
    assert.deepEqual(await stored(), modelBefore);
    assert.equal(
      await page.locator('.object-gizmo').getAttribute('data-active'),
      'false',
    );
    await cdp.detach();
    const check = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      bar: document
        .querySelector('.object-gizmo')
        .getBoundingClientRect()
        .toJSON(),
      camera: document
        .querySelector('.camera-gizmo')
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.equal(check.overflow, false);
    assert.ok(check.bar.height <= Math.min(height * 0.38, 320));
    assert.ok(
      check.bar.right <= check.camera.x || check.bar.bottom <= check.camera.y,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS direct gizmo movement, cancel, undo, rotate, stretch, marker persistence, layout',
      width,
    );
    await context.close();
  }
} finally {
  clearTimeout(timeout);
  await browser.close();
}
