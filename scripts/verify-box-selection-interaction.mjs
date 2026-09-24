import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserRuntime } from './browser-runtime.mjs';

const browser = await browserRuntime().chromium.launch({
  headless: true,
  executablePath: process.env.MAP_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
const annotation = {
  id: 'box-gesture-fixture', kind: 'pin', name: '框选测试点', note: '', color: '#27a879',
  coordinates: [0, 20], groundElevation: null, placement: 'surface', offset: 0,
  width: 20, length: 20, height: 10, heading: 0, pitch: 0, roll: 0, opacity: 0.85, visible: true,
};
await mkdir('artifacts/screenshots', { recursive: true });

try {
  const sizes = process.env.BOX_SELECTION_WIDTH
    ? [[Number(process.env.BOX_SELECTION_WIDTH), Number(process.env.BOX_SELECTION_HEIGHT || 780)]]
    : [[390, 857], [360, 780]];
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true });
    await context.addInitScript(value => localStorage.setItem('guanyun.annotations.v1', JSON.stringify([value])), annotation);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const camera = async () => page.evaluate(() => {
      const root = document.body;
      const fiberElement = [root, ...root.querySelectorAll('*')].find(el => Object.keys(el).some(key => key.startsWith('__reactFiber$')));
      const fiberKey = fiberElement && Object.keys(fiberElement).find(key => key.startsWith('__reactFiber$'));
      if (!fiberElement || !fiberKey) return null;
      const stack = [fiberElement[fiberKey]], seen = new Set();
      while (stack.length) {
        const fiber = stack.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        const api = fiber.ref?.current ?? fiber.memoizedProps?.ref?.current ?? fiber.pendingProps?.ref?.current;
        if (typeof api?.inspect === 'function') {
          const state = api.inspect();
          if (state?.ready) return { center: state.center, zoom: state.zoom, pitch: state.pitch, bearing: state.bearing };
        }
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
      }
      return null;
    });
    const setMapView = async pitch => page.evaluate(value => {
      const root = document.body;
      const element = [root, ...root.querySelectorAll('*')].find(node => Object.keys(node).some(name => name.startsWith('__reactFiber$')));
      const key = element && Object.keys(element).find(name => name.startsWith('__reactFiber$'));
      if (!element || !key) return false;
      const stack = [element[key]], seen = new Set();
      while (stack.length) {
        const fiber = stack.pop();
        if (!fiber || seen.has(fiber)) continue;
        seen.add(fiber);
        const api = fiber.ref?.current ?? fiber.memoizedProps?.ref?.current ?? fiber.pendingProps?.ref?.current;
        if (typeof api?.view === 'function' && typeof api?.zoom === 'function') {
          api.zoom(9);
          setTimeout(() => api.view(value, 0, false), 600);
          return true;
        }
        if (fiber.sibling) stack.push(fiber.sibling);
        if (fiber.child) stack.push(fiber.child);
      }
      return false;
    }, pitch);
    await page.goto(process.env.BOX_SELECTION_URL || 'http://127.0.0.1:9437', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '框选对象' }).waitFor();
    await page.getByRole('button', { name: '框选对象' }).click();
    const surface = page.locator('.map-box-surface');
    await surface.waitFor({ timeout: 5000 }).catch(async error => {
      console.log('box surface did not open', {
        width, height,
        errors,
        selectionNodes: await page.locator('.map-box-selection').evaluateAll(nodes => nodes.map(node => ({ active: node.dataset.active, html: node.outerHTML.slice(0, 300) }))),
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      });
      throw error;
    });
    const drag = async () => {
      const rect = await surface.boundingBox();
      assert.ok(rect);
      const x1 = rect.x + rect.width * 0.2, x2 = rect.x + rect.width * 0.8;
      const y1 = rect.y + rect.height * 0.24, y2 = rect.y + rect.height * 0.72;
      await page.mouse.move(x1, y1);
      await page.mouse.down();
      await page.mouse.move(x2, y2, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    };
    await drag();
    await page.locator('.map-box-selected-result').getByText('框选测试点', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '加选', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.screenshot({ path: `artifacts/screenshots/box-selection-live-${width}.png` });

    const dock = page.locator('.map-box-tools');
    assert.equal(await page.locator('.control-dock:has(.catalog-panel) .control-popover').isVisible().catch(() => false), false, 'live box mode should hide the unused collection popover');
    const bounds = await dock.evaluate(el => {
      const r = el.getBoundingClientRect();
      const nav = document.querySelector('.home-bottom-nav')?.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, navWidth: nav?.width ?? 0, navHeight: nav?.height ?? 0, gapToNav: nav ? nav.top - r.bottom : null };
    });
    assert.ok(bounds.width <= 300 && bounds.height <= 200, JSON.stringify(bounds));
    if (bounds.navWidth > 0 && bounds.navHeight > 0)
      assert.ok(bounds.gapToNav >= 4 && bounds.gapToNav <= 8, JSON.stringify(bounds));
    console.log(`box dock ${width}x${height}`, bounds);

    await page.getByRole('button', { name: '减选', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '减选', exact: true }).getAttribute('aria-pressed'), 'true');
    await drag();
    assert.equal(await page.locator('.map-box-selected-result').count(), 0, 'subtract box should remove the fixture');
    await page.getByRole('button', { name: '加选', exact: true }).click();
    await drag();
    await page.locator('.map-box-selected-result').getByText('框选测试点', { exact: true }).waitFor();

    // Drive real Chromium touch pointers through the overlay and verify all three camera axes.
    const box = await surface.boundingBox();
    assert.ok(box);
    const cdp = await context.newCDPSession(page);
    let first = { x: Math.round(box.x + box.width * 0.32), y: Math.round(box.y + box.height * 0.5), id: 1 };
    let second = { x: Math.round(box.x + box.width * 0.58), y: Math.round(box.y + box.height * 0.5), id: 2 };
    const testedPitch = width === 360 ? 45 : 0;
    assert.equal(await setMapView(testedPitch), true, 'map view control must be available for 2D/3D gesture checks');
    await page.waitForTimeout(750);
    const marker = await page.locator('.annotation-marker-name').evaluate(el => el.closest('.maplibregl-marker').getBoundingClientRect().toJSON());
    const cameraBeforeGesture = await camera();
    assert.ok(cameraBeforeGesture, 'map camera must be inspectable before the gesture');
    assert.ok(cameraBeforeGesture.zoom > 8 && cameraBeforeGesture.zoom < 12,
      `gesture check should use a realistic zoom, got ${cameraBeforeGesture.zoom}`);
    assert.ok(Math.abs(cameraBeforeGesture.pitch - testedPitch) < 1, `expected ${testedPitch}° test pitch`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
    first = { ...first, x: first.x + 8, y: first.y + 5 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first] });
    assert.equal(await page.locator('.map-box-rectangle').count(), 1, 'single finger should begin a selection rectangle');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
    assert.equal(await page.locator('.map-box-rectangle').count(), 0, 'second finger must cancel the active rectangle');
    const dispatchPair = async (a, b) => cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [a, b] });
    const frames = async (fromA, fromB, toA, toB, count = 5) => {
      for (let i = 1; i <= count; i++) {
        const t = i / count;
        await dispatchPair(
          { ...fromA, x: Math.round(fromA.x + (toA.x - fromA.x) * t), y: Math.round(fromA.y + (toA.y - fromA.y) * t) },
          { ...fromB, x: Math.round(fromB.x + (toB.x - fromB.x) * t), y: Math.round(fromB.y + (toB.y - fromB.y) * t) },
        );
        await page.waitForTimeout(16);
      }
    };
    const panStart = await camera();
    const panA = { ...first, x: first.x + 34, y: first.y + 24 };
    const panB = { ...second, x: second.x + 34, y: second.y + 24 };
    const earlyA = { ...first, x: first.x + 7, y: first.y + 5 };
    const earlyB = { ...second, x: second.x + 7, y: second.y + 5 };
    const responsivenessStart = Date.now();
    await dispatchPair(earlyA, earlyB);
    await page.waitForTimeout(32);
    const firstFrameCamera = await camera();
    assert.ok(Math.abs(firstFrameCamera.center[0] - panStart.center[0]) > 1e-5 || Math.abs(firstFrameCamera.center[1] - panStart.center[1]) > 1e-5,
      `camera should update during the first touch frame: ${JSON.stringify({ panStart, firstFrameCamera })}`);
    const firstFrameMs = Date.now() - responsivenessStart;
    assert.ok(firstFrameMs < 400, `camera update should be responsive: ${firstFrameMs}ms`);
    await frames(earlyA, earlyB, panA, panB, 4);
    first = panA; second = panB;
    await page.waitForTimeout(100);
    const panEnd = await camera();
    const markerAfterPan = await page.locator('.annotation-marker-name').evaluate(el => el.closest('.maplibregl-marker').getBoundingClientRect().toJSON());
    assert.ok(markerAfterPan.x - marker.x > 15 && markerAfterPan.y - marker.y > 8,
      `marker should follow the fingers in both screen axes: ${JSON.stringify({ marker, markerAfterPan, panStart, panEnd })}`);
    assert.ok(Math.abs(panEnd.zoom - panStart.zoom) < 0.03, `translation should not zoom: ${JSON.stringify({ panStart, panEnd })}`);
    assert.ok(Math.abs(panEnd.bearing - panStart.bearing) < 0.5, `translation should not rotate: ${JSON.stringify({ panStart, panEnd })}`);
    assert.ok(Date.now() - responsivenessStart < 1000, 'camera should respond during the active touch stream');

    const rotationStart = await camera();
    const cx = (first.x + second.x) / 2, cy = (first.y + second.y) / 2;
    const vx = (first.x - second.x) / 2, vy = (first.y - second.y) / 2;
    const angle = 35 * Math.PI / 180, scale = 1.7;
    const rotateA = { ...first, x: Math.round(cx + scale * (vx * Math.cos(angle) - vy * Math.sin(angle))), y: Math.round(cy + scale * (vx * Math.sin(angle) + vy * Math.cos(angle))) };
    const rotateB = { ...second, x: Math.round(cx - scale * (vx * Math.cos(angle) - vy * Math.sin(angle))), y: Math.round(cy - scale * (vx * Math.sin(angle) + vy * Math.cos(angle))) };
    await frames(first, second, rotateA, rotateB);
    first = rotateA; second = rotateB;
    await page.waitForTimeout(50);
    const cameraAfterGesture = await camera();
    const markerAfterGesture = await page.locator('.annotation-marker-name').evaluate(el => el.closest('.maplibregl-marker').getBoundingClientRect().toJSON());
    const bearingDelta = ((cameraAfterGesture.bearing - rotationStart.bearing + 540) % 360) - 180;
    assert.ok(cameraAfterGesture.zoom - rotationStart.zoom > 0.55, `pinch out should zoom in: ${JSON.stringify({ rotationStart, cameraAfterGesture })}`);
    assert.ok(bearingDelta < -25 && bearingDelta > -45,
      `clockwise finger twist should rotate the map naturally: ${JSON.stringify({ rotationStart, cameraAfterGesture, bearingDelta })}`);
    assert.ok(Math.hypot(markerAfterGesture.x - markerAfterPan.x, markerAfterGesture.y - markerAfterPan.y) > 5, 'pinch/rotate should update rendered map content');
    assert.deepEqual(errors, [], `page errors during gesture: ${errors.join('; ')}`);
    console.log(`camera gesture ${width}x${height}`, {
      cameraBeforeGesture, panStart, panEnd, rotationStart, cameraAfterGesture,
      panMarkerDelta: { x: markerAfterPan.x - marker.x, y: markerAfterPan.y - marker.y },
      firstFrameMs,
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...second, x: second.x + 10, y: second.y + 8 }] });
    assert.equal(await page.locator('.map-box-rectangle').count(), 0, 'remaining finger must not resume the cancelled rectangle');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal(await page.locator('.map-box-selected-result').count(), 1, 'cancelled two-finger gesture must not commit a stale box');

    // Action buttons live in the selection dock; choosing an action preserves the box-mode session.
    const markerBeforeExport = await page.locator('.annotation-marker-name').evaluate(el => el.closest('.maplibregl-marker').getBoundingClientRect().toJSON());
    const cameraBeforeExport = await camera();
    await page.getByRole('button', { name: '导出', exact: true }).click();
    assert.equal(await page.locator('.map-box-selection[data-active="true"]').count(), 1);
    await page.locator('.map-box-action-flow').getByRole('button', { name: '返回框选', exact: true }).waitFor();
    assert.equal(await page.locator('.collection-fixed-header > button:first-child').isVisible().catch(() => false), false, 'action flow should keep only the body back button');
    assert.equal(await page.locator('.collection-back').isVisible(), true);
    const markerAfterExport = await page.locator('.annotation-marker-name').evaluate(el => el.closest('.maplibregl-marker').getBoundingClientRect().toJSON());
    const cameraAfterExport = await camera();
    console.log(`camera export ${width}x${height}`, {
      before: cameraBeforeExport, after: cameraAfterExport,
      markerDelta: { x: markerAfterExport.x - markerBeforeExport.x, y: markerAfterExport.y - markerBeforeExport.y },
    });
    if (cameraBeforeExport && cameraAfterExport) assert.deepEqual(cameraAfterExport, cameraBeforeExport, 'opening export must preserve camera center and zoom');
    await page.screenshot({ path: `artifacts/screenshots/box-selection-action-${width}.png` });
    await page.locator('.map-box-action-flow').getByRole('button', { name: '返回框选', exact: true }).click();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('.box-results').getByRole('button', { name: '返回框选', exact: true }).waitFor();
    await page.locator('.box-results').getByRole('button', { name: '返回框选', exact: true }).click();
    await surface.waitFor();
    const beforeExit = await page.locator('.map-canvas').evaluate(el => el.getBoundingClientRect().toJSON());
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.getByRole('region', { name: /框选结果/ }).waitFor();
    await page.locator('.box-results-list').getByText('框选测试点', { exact: true }).waitFor();
    const afterExit = await page.locator('.map-canvas').evaluate(el => el.getBoundingClientRect().toJSON());
    assert.ok(Math.abs(afterExit.width - beforeExit.width) < 1 && Math.abs(afterExit.height - beforeExit.height) < 1, 'exiting box mode must keep the map viewport size stable');

    await page.getByRole('button', { name: '继续框选', exact: true }).click();
    await surface.waitFor();
    await page.getByRole('button', { name: '清空', exact: true }).click();
    await page.getByRole('button', { name: '退出', exact: true }).click();
    await page.locator('.map-box-selection').waitFor({ state: 'detached' });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.collection-workbench').count(), 0, 'empty-selection exit should close favorites instead of fitting its overview');
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
