import assert from 'node:assert/strict';
const delta = (a, b) => ((a - b + 540) % 360) - 180;

/** Actual mouse/touch input while a route preview is selected. Isolated test only. */
export async function verifyPreviewCamera(page, context, width) {
  const sample = () =>
    page.evaluate(() => ({
      pitch: window.__map.getPitch(),
      bearing: window.__map.getBearing(),
      preview: document
        .querySelector('.rail-colors')
        ?.getAttribute('aria-valuenow'),
      marker: document.querySelector('.route-preview-cursor') !== null,
    }));
  await page.evaluate(() => window.__map.jumpTo({ pitch: 40, bearing: 0 }));
  await page.waitForFunction(
    () =>
      document.querySelector('.camera-model')?.getAttribute('aria-valuenow') ===
      '40',
  );
  const rect = await page.locator('.camera-gizmo svg').boundingBox();
  const point = (x, y) => [
    rect.x + (x * rect.width) / 110,
    rect.y + (y * rect.height) / 118,
  ];
  const mouse = async (dx, dy) => {
    await page.mouse.move(...point(55, 48));
    await page.mouse.down();
    await page.mouse.move(...point(55 + dx, 48 + dy), { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(80);
  };
  await mouse(20, 0);
  let value = await sample();
  assert.ok(
    Math.abs(value.pitch - 40) < 0.5 && Math.abs(value.bearing - 27) < 0.5,
    JSON.stringify(value),
  );
  await mouse(0, -16);
  value = await sample();
  assert.ok(
    Math.abs(value.pitch - 61.6) < 0.5 && Math.abs(value.bearing - 27) < 0.5,
  );
  await mouse(12, 14);
  value = await sample();
  assert.ok(
    Math.abs(value.pitch - 42.7) < 0.5 && Math.abs(value.bearing - 43.2) < 0.5,
  );
  // A blur must end the drag immediately; later movement cannot reuse its origin.
  await page.mouse.move(...point(55, 48));
  await page.mouse.down();
  await page.mouse.move(...point(62, 42));
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurred = await sample();
  await page.mouse.move(...point(20, 10));
  await page.mouse.up();
  assert.deepEqual(await sample(), blurred);
  await mouse(10, 0);
  value = await sample();
  assert.ok(Math.abs(delta(value.bearing, blurred.bearing) - 13.5) < 0.5);
  const cdp = await context.newCDPSession(page);
  const touch = async (type, x, y) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: ['touchEnd', 'touchCancel'].includes(type)
        ? []
        : [{ x: point(x, y)[0], y: point(x, y)[1] }],
    });
  const start = await sample();
  await touch('touchStart', 55, 48);
  await touch('touchMove', 67, 34);
  await touch('touchMove', 80, 24); // Leaves the visible model; SVG capture retains the gesture.
  await touch('touchEnd', 0, 0);
  value = await sample();
  assert.ok(Math.abs(delta(value.bearing, start.bearing) - 33.75) < 1);
  assert.ok(value.pitch > start.pitch + 20);
  const orbit = await sample();
  await touch('touchStart', 100, 81);
  await touch('touchMove', 87, 98);
  await touch('touchMove', 55, 104);
  await touch('touchEnd', 0, 0);
  value = await sample();
  assert.ok(Math.abs(delta(value.bearing, orbit.bearing) - 90) < 1);
  assert.ok(Math.abs(value.pitch - orbit.pitch) < 0.5);
  await touch('touchStart', 55, 48);
  await touch('touchMove', 63, 44);
  await touch('touchCancel', 0, 0);
  const cancelled = await sample();
  await mouse(-10, 0);
  value = await sample();
  assert.ok(Math.abs(delta(value.bearing, cancelled.bearing) + 13.5) < 1);
  assert.equal(value.preview, '80');
  assert.equal(value.marker, true);
  // A canceled drag leaves the keyboard and subsequent route scrub usable.
  const model = page.locator('.camera-model');
  await model.focus();
  await model.press('ArrowLeft');
  await model.press('ArrowDown');
  const keyed = await sample();
  assert.ok(Math.abs(delta(keyed.bearing, value.bearing) + 5) < 0.5);
  assert.ok(Math.abs(keyed.pitch - (value.pitch - 5)) < 0.5);
  await page.screenshot({
    path: `artifacts/screenshots/preview-camera-fixed-${width}.png`,
  });
  console.log(
    'CAMERA PASS',
    width,
    'mouse axes/diagonal, touch capture/ring/cancel, blur recovery, keyboard, preview retained',
  );
}
