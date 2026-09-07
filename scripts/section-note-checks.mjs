import assert from 'node:assert/strict';
import { verifySectionPointDrag } from './section-point-drag-checks.mjs';
import {
  verifyScaleSettings,
  verifySectionPersistence,
} from './section-state-checks.mjs';
const key = 'shantu.section-points.v1';
export async function verifySectionNotes(page, profile, width) {
  const stored = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), key);
  const slider = profile.getByRole('slider', { name: '沿交线查看点海拔' });
  const add = async (fraction, name) => {
    await slider.fill(String(fraction));
    await profile
      .getByRole('button', { name: '添加交线测点', exact: true })
      .click();
    await profile
      .locator('.section-note-row')
      .last()
      .getByRole('button')
      .first()
      .click();
    await profile
      .getByRole('textbox', { name: '测点名称', exact: true })
      .fill(name);
  };
  await add(250, '砂岩露头');
  await profile
    .getByRole('textbox', { name: '测点备注', exact: true })
    .fill('浅黄色砂岩\n边界清晰');
  await profile.getByRole('button', { name: '＋ 数据项', exact: true }).click();
  await profile
    .getByRole('textbox', { name: '数据 1 名称', exact: true })
    .fill('厚度');
  await profile
    .getByRole('textbox', { name: '数据 1 内容', exact: true })
    .fill('2.5');
  await profile
    .getByRole('textbox', { name: '数据 1 单位', exact: true })
    .fill('m');
  await profile.getByRole('button', { name: '保存测点', exact: true }).click();
  await add(750, '裂隙位置');
  await profile.getByRole('button', { name: '保存测点', exact: true }).click();
  let records = await stored();
  assert.equal(records.length, 1);
  assert.equal(records[0].notes.length, 2);
  assert.notDeepEqual(
    records[0].notes[0].point.coordinates,
    records[0].notes[1].point.coordinates,
  );
  assert.equal(records[0].notes[0].fields[0].value, '2.5');
  assert.equal(records[0].notes[0].source, 'model');
  assert.notEqual(records[0].notes[0].color, records[0].notes[1].color);
  const original = records[0];
  await verifySectionPointDrag(page, profile);
  records = await stored();
  await profile
    .getByRole('button', { name: '编辑测点 裂隙位置', exact: true })
    .click();
  await profile
    .getByRole('textbox', { name: '测点名称', exact: true })
    .fill('不会保存的修改');
  await profile.getByRole('button', { name: '取消', exact: true }).click();
  assert.deepEqual(await stored(), records);
  await profile
    .getByRole('button', { name: '编辑测点 裂隙位置', exact: true })
    .click();
  await profile
    .getByRole('textbox', { name: '测点备注', exact: true })
    .fill('裂隙发育');
  await profile.getByRole('button', { name: '保存测点', exact: true }).click();
  assert.equal((await stored())[0].notes.length, 2);
  // Storage failure retains the draft and old persisted points; retry writes once.
  await add(500, '临时测点');
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    window.__restoreNotesStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (k, v) {
      if (k === key) throw new Error('quota');
      return original.call(this, k, v);
    };
  }, key);
  await profile.getByRole('button', { name: '保存测点', exact: true }).click();
  assert.equal((await stored())[0].notes.length, 3);
  assert.equal((await stored())[0].notes[2].name, '测点 3');
  assert.equal(
    await profile
      .getByRole('textbox', { name: '测点名称', exact: true })
      .inputValue(),
    '临时测点',
  );
  assert.ok(await profile.getByRole('alert').isVisible());
  await page.evaluate(() => window.__restoreNotesStorage());
  await profile.getByRole('button', { name: '保存测点', exact: true }).click();
  assert.equal((await stored())[0].notes.length, 3);
  await profile
    .getByRole('button', { name: '删除选中的交线测点', exact: true })
    .click();
  assert.equal((await stored())[0].notes.length, 2);
  // Every requested preset, both axes, keeps the centre and creates no new note records.
  await verifyScaleSettings(page, profile, width, true);
  for (const size of [100, 200, 500, 1000, 2000, 5000, 10000]) {
    for (const label of ['剖面宽度', '剖面高度'])
      await profile
        .getByRole('combobox', { name: label, exact: true })
        .selectOption(String(size));
    await page.waitForFunction((size) => {
      const p =
        window.__map.getLayer('section-plane').implementation.settings.plane;
      return p.width === size && p.height === size;
    }, size);
    const ruler = await page.evaluate(() => {
      const layer = window.__map.getLayer('section-plane').implementation;
      return {
        center: layer.settings.plane.center,
        labels: [...layer.ruler.labels.keys()],
        count: layer.ruler.children.length,
      };
    });
    assert.deepEqual(ruler.center, original.settings.plane.center);
    assert.ok(ruler.labels.includes(`${size} m`));
    assert.ok(ruler.count >= 6);
    assert.equal(await profile.locator('.section-note-row').count(), 0);
  }
  await page.screenshot({
    path: `artifacts/screenshots/section-size-presets-${width}.png`,
  });
  // A page reload drops transient section state. Restore the saved original plane via its UI.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () =>
      window.__map?.getLayer('section-plane') &&
      window.__map?.terrain?.getCoverageIndex?.()?.samplerPerTile.size > 0,
    null,
    { timeout: 35000 },
  );
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
  await profile
    .getByRole('button', { name: '编辑测点 砂岩露头', exact: true })
    .waitFor();
  assert.equal((await stored())[0].notes.length, 2);
  await profile
    .getByRole('button', { name: '编辑测点 砂岩露头', exact: true })
    .click();
  assert.equal(
    await profile
      .getByRole('textbox', { name: '数据 1 内容', exact: true })
      .inputValue(),
    '2.5',
  );
  await page.screenshot({
    path: `artifacts/screenshots/section-point-data-${width}.png`,
  });
  await profile.getByRole('button', { name: '取消', exact: true }).click();
  await profile
    .getByRole('combobox', { name: '选择交线', exact: true })
    .selectOption({ label: '剖面验证模型 · 1 · 模型' });
  await slider.fill('400');
  await verifySectionPersistence(page, profile, width);
  await verifyScaleSettings(page, profile, width);
  await slider.fill('400');
  await profile.locator('.section-chart-box').scrollIntoViewIfNeeded();
  assert.equal(await profile.locator('.section-chart-note').count(), 2);
  const addBox = await profile
    .getByRole('button', { name: '添加交线测点', exact: true })
    .boundingBox();
  assert.ok(addBox.width >= 44 && addBox.height >= 44);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: `artifacts/screenshots/section-points-chart-${width}.png`,
  });
  console.log(
    'PASS section metric presets/rulers, add/edit/cancel/delete, custom fields, storage failure/retry, reload/archive restore',
    width,
  );
}
