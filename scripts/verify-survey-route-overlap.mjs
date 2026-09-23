import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserRuntime } from './browser-runtime.mjs';
import { newSurveyLine, surveySettings } from '../modules/section/surveyLine.ts';

const track = {
  id: 'overlap-route', name: '测试路线', createdAt: Date.now(),
  segments: [[[103.54, 30.948], [103.58, 30.948]]], source: 'manual',
};
const section = {
  id: 'overlap-section', name: '测试剖面',
  settings: { ...surveySettings(newSurveyLine([103.55, 30.95], [103.57, 30.95])), objectId: 'overlap-section' },
};
let browser;
for (const options of [{ headless: true }, { headless: true, channel: 'chrome' }, { headless: true, channel: 'msedge' }]) {
  try { browser = await browserRuntime().chromium.launch(options); break; } catch { /* Try the installed browser. */ }
}
if (!browser) throw new Error('未找到可用的 Chromium、Chrome 或 Edge');
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 857 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(({ track, section }) => {
    localStorage.setItem('guanyun.manual-tracks.v1', JSON.stringify([track]));
    localStorage.setItem('shantu.section-objects.v1', JSON.stringify([section]));
  }, { track, section });
  await page.route('**/modules/map/TerrainMap.tsx*', async route => {
    const response = await route.fetch();
    const body = await response.text();
    assert.ok(body.includes('mapRef.current = map'));
    await route.fulfill({ response, body: body.replace('mapRef.current = map', 'window.__overlapMap = map; mapRef.current = map') });
  });
  await page.goto('http://127.0.0.1:9433/#13/30.949/103.56/0/0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__overlapMap?.isStyleLoaded(), null, { timeout: 30000 });
  const initialRoute = await page.evaluate(() => {
    const p = window.__overlapMap.project([103.56, 30.948]);
    const rect = window.__overlapMap.getCanvas().getBoundingClientRect();
    return { x: rect.x + p.x, y: rect.y + p.y };
  });
  await page.mouse.click(initialRoute.x, initialRoute.y);
  await page.locator('.home-route-direction').waitFor();
  await page.getByRole('button', { name: '编辑勘探线 测试剖面' }).click();
  await page.getByRole('button', { name: '关闭勘探线剖面' }).waitFor();
  assert.equal(await page.locator('.home-route-direction').count(), 0, 'opening survey clears the earlier route selection');
  const selected = await page.locator('.map-canvas').getAttribute('data-picking');
  assert.equal(selected, 'true', 'survey editor must own the map selection');
  const route = await page.evaluate(() => {
    const p = window.__overlapMap.project([103.56, 30.948]);
    const rect = window.__overlapMap.getCanvas().getBoundingClientRect();
    return { x: rect.x + p.x, y: rect.y + p.y };
  });
  await page.mouse.click(route.x, route.y);
  await page.waitForTimeout(400);
  assert.equal(await page.getByRole('button', { name: '关闭勘探线剖面' }).count(), 1);
  assert.equal(await page.locator('.home-route-direction').count(), 0, 'route rail must stay hidden');
  assert.equal(await page.locator('.route-card').count(), 0, 'route card must stay hidden');
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshots/20260923-survey-route-exclusive-390.png' });
  await page.getByRole('button', { name: '关闭勘探线剖面' }).click();
  await page.waitForTimeout(800);
  const routeAfterClose = await page.evaluate(() => {
    const p = window.__overlapMap.project([103.56, 30.948]);
    const rect = window.__overlapMap.getCanvas().getBoundingClientRect();
    return { x: rect.x + p.x, y: rect.y + p.y };
  });
  await page.mouse.click(routeAfterClose.x, routeAfterClose.y);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'artifacts/screenshots/20260923-survey-route-after-close-390.png' });
  assert.equal(await page.locator('.home-route-direction').count(), 1, 'route can be selected after leaving survey');
  await page.getByRole('button', { name: '编辑勘探线 测试剖面' }).click();
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.home-route-direction').count(), 0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow screen must not overflow horizontally');
  await page.screenshot({ path: 'artifacts/screenshots/20260923-survey-route-exclusive-360.png' });
  assert.deepEqual(errors, []);
  console.log('Survey/route exclusive selection browser check OK');
} finally {
  await browser.close();
}
