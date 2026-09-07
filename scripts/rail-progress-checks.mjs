import assert from 'node:assert/strict';

/** Feed the public geolocation watcher; do not assign component state. */
export async function installRailPositionMock(page) {
  await page.evaluate(() => {
    let receive;
    window.__railFix = (coordinates, options = {}) =>
      receive?.({
        coords: {
          longitude: coordinates[0],
          latitude: coordinates[1],
          accuracy: options.accuracy ?? 5,
        },
        timestamp: Date.now() - (options.age ?? 0),
      });
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition(callback) {
          receive = callback;
          window.__railFix([104.066, 30.659]);
          return 1;
        },
        clearWatch() {
          receive = null;
        },
      },
    });
  });
}

export async function verifyRailPreviewLayout(page, width) {
  const label = page.locator('.rail-distance');
  assert.equal(await label.textContent(), '览 19.2 km');
  assert.equal(await label.getAttribute('data-preview'), 'true');
  const [text, thumb, detail] = await Promise.all([
    label.boundingBox(),
    page.locator('.rail-thumb').boundingBox(),
    page.locator('.rail-detail').boundingBox(),
  ]);
  assert.ok(
    text.height <= 20 &&
      Math.abs(text.y + text.height / 2 - thumb.y - thumb.height / 2) < 1,
  );
  assert.ok(text.x >= thumb.x + thumb.width && text.x + text.width < detail.x);
  assert.ok(detail.x + detail.width <= width - 52);
  const backgrounds = await page
    .locator('.rail-tracks span')
    .evaluateAll((spans) => spans.map((span) => span.style.background));
  assert.ok(
    backgrounds.every((value) => value.startsWith('linear-gradient(to top,')),
  );
  await page.screenshot({
    path: `artifacts/screenshots/route-rail-reversed-${width}.png`,
  });
}

export async function verifyRailPositionProgress(page, width) {
  const slider = page.getByRole('slider', { name: '拖动浏览行程' });
  const push = async (coordinates, options = {}) => {
    await page.evaluate(
      ({ coordinates, options }) => window.__railFix(coordinates, options),
      { coordinates, options },
    );
    await page.waitForTimeout(100);
  };
  const state = () =>
    page.locator('.rail-distance').evaluate((label) => ({
      text: label.textContent,
      unavailable: label.dataset.unavailable,
      preview: label.dataset.preview,
      thumb: parseFloat(document.querySelector('.rail-thumb').style.top),
      gps: document.querySelector('.rail-gps')?.style.top,
    }));
  await push([104.045, 30.641]);
  assert.equal(await slider.getAttribute('aria-valuenow'), '0');
  assert.equal((await state()).text, '0.0 km');
  await push([104.168, 30.6095]);
  const middle = await state();
  assert.ok(middle.thumb > 35 && middle.thumb < 55);
  assert.equal(middle.preview, 'false');
  assert.equal(
    middle.text,
    `${((24 * Number(await slider.getAttribute('aria-valuenow'))) / 100).toFixed(1)} km`,
  );
  await page.screenshot({
    path: `artifacts/screenshots/route-rail-live-${width}.png`,
  });
  await push([104.27, 30.56]);
  assert.equal(await slider.getAttribute('aria-valuenow'), '100');
  assert.equal((await state()).text, '24.0 km');
  assert.equal((await state()).thumb, 0);
  // Preview stays where the user placed it while the real GPS dot still moves.
  await slider.press('Home');
  await push([104.168, 30.6095]);
  const preview = await state();
  assert.equal(preview.text, '览 0.0 km');
  assert.equal(preview.thumb, 100);
  assert.ok(parseFloat(preview.gps) < 55);
  await page.getByRole('button', { name: '关闭行程预览', exact: true }).click();
  assert.equal((await state()).text, middle.text);
  // Missing/poor/off-route fixes must not invent a travelled distance.
  for (const [coordinates, options] of [
    [[104.168, 30.6095], { accuracy: 300 }],
    [[104.168, 30.6095], { age: 61000 }],
    [[105, 31], {}],
  ]) {
    await push(coordinates, options);
    assert.equal((await state()).text, '— km');
    assert.equal((await state()).unavailable, 'true');
    assert.equal(await page.locator('.rail-gps').count(), 0);
  }
  await push([104.168, 30.6095]);
  assert.equal((await state()).text, middle.text);
}
