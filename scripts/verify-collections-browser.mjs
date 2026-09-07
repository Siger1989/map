// Synthetic records in isolated browser contexts; never edits the user's current map data.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { browserRuntime } from './browser-runtime.mjs';
const STORE = 'shantu.route-collections.v1',
  ROUTES = 'guanyun.route-favorites.v1',
  TRACKS = 'guanyun.manual-tracks.v1';
const points = [
  [13.4, 52.5],
  [13.41, 52.5],
];
const favorite = (id, mode = 'bicycle') => ({
  id,
  name: `测试路线${id}`,
  savedAt: 100,
  start: { name: '测试起点', coordinates: points[0] },
  end: { name: '测试终点', coordinates: points[1] },
  route: {
    mode,
    coordinates: points,
    distance: 1000,
    duration: 600,
    createdAt: 100,
    snapped: points,
    steps: [],
  },
});
const routes = [
  favorite('A'),
  favorite('B'),
  favorite('C'),
  favorite('驾车', 'auto'),
  favorite('步行', 'pedestrian'),
];
const tracks = ['recorded', 'gpx', 'kml', 'manual'].map((source, i) => ({
  id: `t${i}`,
  name: `测试轨迹${source}`,
  source,
  createdAt: 100,
  segments: [points],
}));
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
    await context.addInitScript(
      ({ ROUTES, TRACKS, routes, tracks }) => {
        if (!localStorage.getItem('collections-fixture')) {
          localStorage.setItem(ROUTES, JSON.stringify(routes));
          localStorage.setItem(TRACKS, JSON.stringify(tracks));
          localStorage.setItem('collections-fixture', '1');
        }
      },
      { ROUTES, TRACKS, routes, tracks },
    );
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.setDefaultTimeout(15000);
    const read = () =>
      page.evaluate((k) => JSON.parse(localStorage.getItem(k)), STORE);
    const button = (name) => page.getByRole('button', { name, exact: true });
    const open = async () => {
      await button('收藏').click();
      await page.locator('.collections-panel').waitFor();
    };
    const group = (id) =>
      page.locator(`[data-collection-target="group|${id}"]`);
    const entry = (id) => page.locator(`[data-entry-key="route:${id}"]`);
    const drag = async (from, to, touch = false, cancel = false) => {
      await from.scrollIntoViewIfNeeded();
      const a = await from.boundingBox(),
        b = await to.boundingBox();
      assert.ok(a && b);
      const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 },
        end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      if (touch) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...start, id: 1 }],
        });
        for (let i = 1; i <= 10; i++)
          await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              {
                x: start.x + ((end.x - start.x) * i) / 10,
                y: start.y + ((end.y - start.y) * i) / 10,
                id: 1,
              },
            ],
          });
        await cdp.send('Input.dispatchTouchEvent', {
          type: cancel ? 'touchCancel' : 'touchEnd',
          touchPoints: [],
        });
        await cdp.detach();
      } else {
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 12 });
        if (cancel) await page.keyboard.press('Escape');
        await page.mouse.up();
      }
      await page.waitForTimeout(150);
    };
    await page.goto('http://localhost:3000/#1/18/0');
    await page.locator('.maplibregl-canvas').waitFor();
    await open();
    assert.equal(await page.locator('[data-entry-key]').count(), 9);
    assert.equal(await page.locator('.route-tabs').count(), 0);
    assert.equal(await group('bicycle').innerText(), '骑行路线\n3');
    assert.equal(
      await page.evaluate((k) => localStorage.getItem(k), STORE),
      null,
    );
    await button('新建分组').click();
    await page.getByLabel('分组名称', { exact: true }).fill('川藏骑行');
    await button('紫色').click();
    await button('保存分组').click();
    let layout = await read(),
      trip = layout.groups.find((g) => g.name === '川藏骑行');
    assert.equal(trip.color, '#c6a0ff');
    // Keyboard is a complete alternative to dragging, including a group at the end of the list.
    const grip = button('拖动分组 川藏骑行');
    await grip.focus();
    for (let i = 0; i < 6; i++) await grip.press('ArrowUp');
    assert.equal((await read()).groups[0].id, trip.id);
    // Touch reorder first two groups, then move back with pointer dragging.
    await page
      .locator('[aria-label="分组列表"]')
      .evaluate((el) => (el.scrollTop = 0));
    await drag(grip, group('auto'), true);
    assert.equal((await read()).groups[1].id, trip.id);
    await drag(grip, group('auto'));
    assert.equal((await read()).groups[0].id, trip.id);
    const groupScroll = page.locator('[aria-label="分组列表"]');
    await groupScroll.evaluate((el) => (el.scrollTop = 0));
    const scrollBox = await groupScroll.boundingBox(),
      gripBox = await grip.boundingBox();
    const beforeScroll = JSON.stringify(await read());
    await page.mouse.move(gripBox.x + 22, gripBox.y + 22);
    await page.mouse.down();
    await page.mouse.move(
      scrollBox.x + scrollBox.width / 2,
      scrollBox.y + scrollBox.height - 5,
      { steps: 6 },
    );
    await page.waitForTimeout(350);
    assert.ok(await groupScroll.evaluate((el) => el.scrollTop > 0));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(JSON.stringify(await read()), beforeScroll);
    await group(trip.id).locator('.collection-open').click();
    await page.getByLabel('分组名称', { exact: true }).fill('川藏旅行');
    await button('粉色').click();
    await button('保存分组').click();
    await button('返回收藏').click();
    const tabs = page.locator('.collection-tabs'),
      tabBox = await tabs.boundingBox(),
      itemGrip = await button('拖动路线 测试路线A').boundingBox();
    await page.mouse.move(itemGrip.x + 22, itemGrip.y + 22);
    await page.mouse.down();
    await page.mouse.move(tabBox.x + tabBox.width - 4, tabBox.y + 22, {
      steps: 6,
    });
    await page.waitForTimeout(350);
    assert.ok(await tabs.evaluate((el) => el.scrollLeft > 0));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await tabs.evaluate((el) => (el.scrollLeft = 0));
    // A route moves directly onto a category tab and retains original geometry/storage.
    await drag(button('拖动路线 测试路线A'), group(trip.id), true);
    assert.equal((await read()).assignments['route:A'], trip.id);
    await group(trip.id).click();
    assert.equal(await page.locator('[data-entry-key]').count(), 1);
    assert.equal(
      await entry('A').locator('.collection-badge').innerText(),
      '川藏旅行',
    );
    assert.equal(
      await entry('A').evaluate((el) => getComputedStyle(el).borderLeftColor),
      'rgb(245, 157, 189)',
    );
    // Cancellation and moving outside never commit.
    const beforeCancel = JSON.stringify(await read());
    await drag(button('拖动路线 测试路线A'), group('auto'), false, true);
    assert.equal(JSON.stringify(await read()), beforeCancel);
    await drag(button('拖动路线 测试路线A'), group('auto'), true, true);
    assert.equal(JSON.stringify(await read()), beforeCancel);
    const outsideGrip = await button('拖动路线 测试路线A').boundingBox();
    await page.mouse.move(outsideGrip.x + 22, outsideGrip.y + 22);
    await page.mouse.down();
    await page.mouse.move(5, height / 2, { steps: 6 });
    await page.mouse.up();
    assert.equal(JSON.stringify(await read()), beforeCancel);
    await group('bicycle').evaluate((el) =>
      el.scrollIntoView({ inline: 'center', block: 'nearest' }),
    );
    await group('bicycle').click();
    await drag(button('拖动路线 测试路线B'), entry('C'), true);
    assert.deepEqual(
      await page
        .locator('[data-entry-key]')
        .evaluateAll((els) => els.map((el) => el.dataset.entryKey)),
      ['route:C', 'route:B'],
    );
    await button('拖动路线 测试路线B').press('ArrowUp');
    assert.deepEqual(
      await page
        .locator('[data-entry-key]')
        .evaluateAll((els) => els.map((el) => el.dataset.entryKey)),
      ['route:B', 'route:C'],
    );
    // Select-based move remains available for users who do not drag.
    await button('整理 测试路线B').click();
    await page.getByLabel('移动到分组', { exact: true }).selectOption(trip.id);
    await button('返回收藏').click();
    await group(trip.id).click();
    assert.equal(await page.locator('[data-entry-key]').count(), 2);
    await page.screenshot({
      path: `artifacts/screenshots/collections-list-${width}.png`,
    });
    // Storage failures keep the current UI/data and permit retry.
    await button('管理分组').click();
    await button('新建分组').click();
    await page.getByLabel('分组名称', { exact: true }).fill('周末徒步');
    await page.evaluate((k) => {
      window.__setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === k) throw new DOMException('quota', 'QuotaExceededError');
        return window.__setItem.call(this, key, value);
      };
    }, STORE);
    await button('保存分组').click();
    await page.getByRole('status').filter({ hasText: '整理未保存' }).waitFor();
    assert.ok(!(await read()).groups.some((g) => g.name === '周末徒步'));
    await page.evaluate(() => (Storage.prototype.setItem = window.__setItem));
    await button('保存分组').click();
    assert.ok((await read()).groups.some((g) => g.name === '周末徒步'));
    // Duplicate names are reported without closing the form.
    await button('新建分组').click();
    await page.getByLabel('分组名称', { exact: true }).fill('周末徒步');
    await button('保存分组').click();
    await page.getByRole('status').filter({ hasText: '同名分组' }).waitFor();
    await button('返回分组').click();
    // Keep a screenshot of the group editor at both sizes.
    await group(trip.id).locator('.collection-open').click();
    await page.screenshot({
      path: `artifacts/screenshots/collections-editor-${width}.png`,
    });
    await button('删除分组，路线移至未分组').click();
    await button('返回收藏').click();
    await group('unfiled').evaluate((el) =>
      el.scrollIntoView({ inline: 'center', block: 'nearest' }),
    );
    await group('unfiled').click();
    assert.equal(await page.locator('[data-entry-key]').count(), 2);
    assert.deepEqual(
      await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), ROUTES),
      routes,
    );
    assert.deepEqual(
      await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), TRACKS),
      tracks,
    );
    const finalLayout = await read();
    await page.reload();
    await page.locator('.maplibregl-canvas').waitFor();
    await open();
    assert.deepEqual(await read(), finalLayout);
    // Actual restore still opens planned routes and their existing navigation action.
    await entry('A').locator('.collection-open').click();
    await page.locator('.route-start-notice').waitFor();
    await open();
    await page
      .locator('.collection-tabs')
      .evaluate((el) => (el.scrollLeft = 0));
    // Check panel/toolbar targets, map tool clearance and page overflow.
    const geometry = await page.evaluate(() => {
      const p = document
          .querySelector('.control-popover')
          .getBoundingClientRect(),
        m = document.querySelector('.map-actions').getBoundingClientRect(),
        n = document.querySelector('.dock-navigation').getBoundingClientRect(),
        w = document.querySelector('.weather-summary').getBoundingClientRect();
      return {
        panel: { right: p.right, bottom: p.bottom, height: p.height },
        mapLeft: m.left,
        navLeft: n.left,
        weatherRight: w.right,
        overflow: document.documentElement.scrollWidth > innerWidth,
        buttons: [
          ...document.querySelectorAll(
            '.dock-navigation button,.collections-panel button',
          ),
        ]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => ({
            label: el.ariaLabel || el.textContent,
            w: el.getBoundingClientRect().width,
            h: el.getBoundingClientRect().height,
          })),
      };
    });
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.panel.right <= geometry.mapLeft);
    assert.ok(
      geometry.weatherRight <= geometry.navLeft,
      JSON.stringify(geometry),
    );
    assert.ok(geometry.panel.height <= Math.min(height * 0.56, 440) + 1);
    assert.ok(
      geometry.buttons.every((b) => b.h >= 43.5 && b.w >= 43.5),
      JSON.stringify(geometry.buttons),
    );
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.collections-panel').count(), 0);
    await open();
    await page.mouse.click(10, height / 2);
    assert.equal(await page.locator('.collections-panel').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      `${width}x${height}: default categories, group create/edit/delete, pointer+touch sorting/moving/cancel, keyboard, storage retry, reload, restore and layout passed`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
