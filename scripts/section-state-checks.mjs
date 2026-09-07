import assert from 'node:assert/strict';
const objectKey = 'shantu.section-object.v1';
const saved = (page) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) || 'null'),
    objectKey,
  );
const layer = (page) =>
  page.evaluate(
    () => window.__map.getLayer('section-plane').implementation.settings,
  );
export async function verifyScaleSettings(
  page,
  profile,
  width,
  restore = false,
) {
  const before = await layer(page);
  await profile
    .getByRole('button', { name: '比例尺设置', exact: true })
    .click();
  await profile
    .getByRole('combobox', { name: '刻度间隔', exact: true })
    .selectOption('custom');
  await profile
    .getByRole('spinbutton', { name: '自定刻度间隔 m', exact: true })
    .fill('5');
  await profile
    .getByRole('spinbutton', { name: '自定刻度间隔 m', exact: true })
    .press('Enter');
  await profile
    .getByRole('combobox', { name: '比例尺单位', exact: true })
    .selectOption('km');
  const input = profile.getByRole('spinbutton', {
    name: '自定刻度间隔 km',
    exact: true,
  });
  assert.equal(await input.inputValue(), '0.005');
  assert.equal((await saved(page)).scale.interval, 5);
  await input.fill('0.002');
  await input.press('Enter');
  assert.equal((await saved(page)).scale.interval, 2);
  await input.fill('-1');
  await input.press('Enter');
  assert.equal((await saved(page)).scale.interval, 2);
  assert.equal(await input.inputValue(), '0.002');
  await input.fill('0.005');
  await input.press('Enter');
  assert.deepEqual((await layer(page)).plane, before.plane);
  assert.equal((await layer(page)).altitude, before.altitude);
  await page.waitForFunction(() =>
    document.querySelector('.section-chart')?.textContent.includes('km'),
  );
  assert.match(await profile.locator('.section-scale-bar').textContent(), /km/);
  assert.equal(await profile.locator('.section-note-row').count(), 2);
  await page.screenshot({
    path: `artifacts/screenshots/section-scale-settings-${width}.png`,
  });
  if (restore) {
    await profile
      .getByRole('combobox', { name: '比例尺单位', exact: true })
      .selectOption('m');
    await profile
      .getByRole('combobox', { name: '刻度间隔', exact: true })
      .selectOption('auto');
  }
}
export async function verifySectionPersistence(page, profile, width) {
  const original = await saved(page);
  assert.ok(original?.enabled);
  await profile
    .getByRole('button', { name: '关闭剖面详情', exact: true })
    .click();
  assert.equal((await layer(page)).enabled, true);
  await page.getByRole('button', { name: '结束对象操作', exact: true }).click();
  assert.equal((await layer(page)).enabled, true);
  assert.equal(
    await page.locator('.observatory').getAttribute('data-section'),
    'false',
  );
  assert.equal(
    await page.locator('.map-canvas').getAttribute('data-picking'),
    'false',
  );
  assert.deepEqual(await saved(page), original);
  const reload = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () =>
        window.__map?.getLayer('section-plane') &&
        window.__map?.terrain?.getCoverageIndex?.()?.samplerPerTile.size > 0,
      null,
      { timeout: 35000 },
    );
  };
  await reload();
  assert.equal((await layer(page)).enabled, true);
  assert.equal(await page.locator('.object-gizmo').count(), 0);
  await page.getByRole('button', { name: '矩形剖面', exact: true }).click();
  await profile.getByRole('button', { name: '隐藏剖面', exact: true }).click();
  assert.equal((await saved(page)).enabled, false);
  assert.deepEqual((await saved(page)).plane, original.plane);
  await reload();
  assert.equal((await layer(page)).enabled, false);
  await page.getByRole('button', { name: '矩形剖面', exact: true }).click();
  assert.equal((await layer(page)).enabled, true);
  assert.deepEqual((await layer(page)).plane, original.plane);
  await profile.getByRole('button', { name: '删除剖面', exact: true }).click();
  assert.equal(await saved(page), null);
  await reload();
  assert.equal((await layer(page)).enabled, false);
  assert.equal((await layer(page)).plane, undefined);
  // Measurement archives remain available; choosing one explicitly recreates its plane.
  await page.getByRole('button', { name: '矩形剖面', exact: true }).click();
  if (!(await profile.isVisible()))
    await page
      .getByRole('button', { name: '查看对象详情', exact: true })
      .click();
  const archive = profile.getByRole('combobox', {
    name: '已保存测点的剖面',
    exact: true,
  });
  const value = await archive.locator('option').nth(1).getAttribute('value');
  await archive.selectOption(value);
  assert.deepEqual((await saved(page)).plane, original.plane);
  await profile
    .getByRole('combobox', { name: '选择交线', exact: true })
    .selectOption({ label: '剖面验证模型 · 1 · 模型' });
  console.log(
    'PASS section remains after closing/deselect/reload; explicit hide/show/delete; archived measurements retained',
    width,
  );
}
