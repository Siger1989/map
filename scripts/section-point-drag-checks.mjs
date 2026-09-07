import assert from 'node:assert/strict';
export async function verifySectionPointDrag(page, profile) {
  const stored = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('shantu.section-points.v1'))[0].notes,
    );
  await page.evaluate(() => {
    window.__noteWrites = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'shantu.section-points.v1') window.__noteWrites++;
      return original.call(this, k, v);
    };
  });
  const handle = profile.getByRole('button', {
    name: '拖动测点 砂岩露头',
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  let notes = await stored(),
    box = await handle.boundingBox();
  const track = await profile.locator('.section-multi-track').boundingBox();
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.5, box.y + 22, { steps: 8 });
  assert.deepEqual(await stored(), notes);
  assert.equal(await page.evaluate(() => window.__noteWrites), 0);
  assert.equal(
    await page.evaluate(
      () =>
        window.__map.getLayer('section-plane').implementation.marks.geometry
          .attributes.position.count,
    ),
    2,
  );
  await page.mouse.up();
  let changed = await stored();
  assert.ok(Math.abs(changed[0].fraction - 0.5) < 0.02);
  assert.deepEqual(changed[1], notes[1]);
  assert.deepEqual(changed[0].fields, notes[0].fields);
  assert.equal(changed[0].color, notes[0].color);
  assert.equal(await page.evaluate(() => window.__noteWrites), 1);
  // Escape restores the previous position and keeps the profile open.
  notes = changed;
  box = await handle.boundingBox();
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(track.x + track.width * 0.2, box.y + 22, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await stored(), notes);
  assert.equal(await profile.count(), 1);
  assert.equal(await page.evaluate(() => window.__noteWrites), 1);
  // Real touch move and cancellation through Chromium's input dispatcher.
  const cdp = await page.context().newCDPSession(page);
  for (const cancel of [true, false]) {
    box = await handle.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + 22, y: box.y + 22, id: 1 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: track.x + track.width * 0.35, y: box.y + 22, id: 1 }],
    });
    assert.deepEqual(await stored(), notes);
    await cdp.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
    if (cancel) assert.deepEqual(await stored(), notes);
  }
  await cdp.detach();
  changed = await stored();
  assert.ok(Math.abs(changed[0].fraction - 0.35) < 0.02);
  assert.deepEqual(changed[1], notes[1]);
  const count = await page.evaluate(() => window.__noteWrites);
  await handle.press('ArrowRight');
  assert.ok(Math.abs((await stored())[0].fraction - 0.36) < 0.02);
  assert.equal(await page.evaluate(() => window.__noteWrites), count + 1);
  // The marker on the chart can also be dragged, snapping to its own contour.
  const graph = profile.getByRole('button', {
    name: '交线上拖动测点 砂岩露头',
    exact: true,
  });
  await graph.scrollIntoViewIfNeeded();
  box = await graph.boundingBox();
  const chart = await profile.locator('.section-chart-plot').boundingBox();
  notes = await stored();
  await page.mouse.move(box.x + 22, box.y + 22);
  await page.mouse.down();
  await page.mouse.move(
    chart.x + chart.width * 0.65,
    chart.y + chart.height * 0.45,
    { steps: 6 },
  );
  assert.deepEqual(await stored(), notes);
  await page.mouse.up();
  assert.notDeepEqual((await stored())[0].point, notes[0].point);
  assert.deepEqual((await stored())[1], notes[1]);
  await handle.scrollIntoViewIfNeeded();
  await handle.click();
  assert.equal(await profile.locator('.section-note-editor').count(), 0);
  assert.ok(
    await profile
      .getByRole('button', { name: '删除选中的交线测点', exact: true })
      .isEnabled(),
  );
  await profile
    .getByRole('button', { name: '编辑选中测点的数据', exact: true })
    .click();
  assert.equal(
    await profile
      .getByRole('textbox', { name: '数据 1 内容', exact: true })
      .inputValue(),
    '2.5',
  );
  await profile.getByRole('button', { name: '取消', exact: true }).click();
  console.log(
    'PASS independent colored handles, line/slider drag, single commit, mouse/touch cancel, keyboard, map points',
  );
}
