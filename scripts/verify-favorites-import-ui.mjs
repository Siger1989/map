import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserRuntime } from './browser-runtime.mjs';

const browser = await browserRuntime().chromium.launch({
  headless: true,
  executablePath: process.env.MAP_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
try {
  await mkdir('artifacts/screenshots', { recursive: true });
  for (const [width, height] of [[390, 857], [360, 780]]) {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(20000);
    await page.goto(`${process.env.SHANTU_PREVIEW_URL || 'http://127.0.0.1:9438'}/#1/18/0`);
    await page.locator('.maplibregl-canvas').waitFor();
    await page.getByRole('button', { name: '收藏', exact: true }).click();
    await page.locator('.collection-workbench').waitFor();
    await page.getByRole('button', { name: '导入收藏文件', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '导入收藏数据' });
    await dialog.waitFor();
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.width <= 300 && bounds.height <= height * 0.56 + 1, `${width}px panel bounds: ${JSON.stringify(bounds)}`);
    await dialog.getByRole('button', { name: '标记 Excel' }).click();
    await dialog.getByRole('button', { name: '选择 XLSX' }).waitFor();
    const excelBounds = await dialog.boundingBox();
    assert.equal(await dialog.locator('.workbench-heading').count(), 1, 'Excel mode should share the same dialog header');
    await page.screenshot({ path: `artifacts/screenshots/favorites-import-excel-${width}.png` });
    await dialog.getByRole('button', { name: '路线、轨迹与备份' }).click();
    await dialog.getByLabel('数据导入导出').locator('input[type=file][multiple]').waitFor();
    await dialog.getByText('选择路线 / 收藏文件', { exact: true }).waitFor();
    await dialog.locator('details').filter({ hasText: '支持格式 / 奥维文件怎么导入' }).locator('summary').click();
    for (const format of ['GPX', 'KML / KMZ', 'TCX', 'FIT', 'GeoJSON', 'CSV / TSV', 'OVJSN', 'OVOBJ', '山兔 JSON 备份']) {
      assert.ok((await dialog.innerText()).includes(format), `missing ${format} in import help`);
    }
    await dialog.locator('details').filter({ hasText: '支持格式 / 奥维文件怎么导入' }).locator('summary').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `artifacts/screenshots/favorites-import-files-${width}.png` });
    await page.close();
    console.log(`${width}x${height}: files ${Math.round(bounds.height)}px, Excel ${Math.round(excelBounds.height)}px; both tabs reachable, no overflow/errors`);
  }
} finally {
  await browser.close();
}
