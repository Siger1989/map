import { browserRuntime } from './browser-runtime.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const phase = process.argv[2] || 'after';
if (!/^[a-z0-9_-]+$/i.test(phase)) throw new Error('Invalid result folder');
const output = path.resolve('artifacts/screenshots/tablet-controls-20261118', phase);
await mkdir(output, {
  recursive: true
});
const browser = await browserRuntime().chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const page = await browser.newPage({
  viewport: {
    width: 960,
    height: 600
  },
  reducedMotion: 'reduce',
  hasTouch: true
});
const representatives = [[360, 780], [390, 857], [390, 815], [390, 480], [600, 960], [768, 1024], [800, 1280], [960, 540], [960, 600], [1024, 599], [1024, 600], [1024, 601], [1024, 768], [1280, 800], [1366, 768], [780, 360], [857, 390], [640, 320], [320, 568], [600, 400], [1280, 720]];
const thresholds = [319, 320, 359, 360, 379, 380, 381, 390, 479, 480, 519, 520, 521, 539, 540, 579, 580, 581, 599, 600, 601, 610, 619, 620, 621, 630, 639, 640, 650, 659, 660, 661, 679, 680, 681, 699, 700, 701, 719, 720, 721, 739, 740, 741, 767, 768];
const pairs = [...representatives, ...thresholds.map(h => [960, h]), ...[359, 390, 480, 599, 600, 601].flatMap(w => [380, 480, 600, 601, 640, 740].map(h => [w, h]))];
const unique = [...new Map(pairs.map(s => [s.join('x'), s])).values()];
const results = [];
const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
function measure() {
  function visible(el) {
    return el && el.checkVisibility({
      checkVisibilityCSS: true
    }) && el.getBoundingClientRect().width > 0;
  }
  function box(el) {
    const {
      x,
      y,
      width: w,
      height: h
    } = el.getBoundingClientRect();
    return {
      x,
      y,
      w,
      h
    };
  }
  const selectors = {
    actions: '.home-map-actions',
    rail: '.home-position-dock',
    scale: '.map-canvas .maplibregl-ctrl-scale',
    joystick: '.home-camera-control .camera-gizmo',
    footer: '.map-toolbar',
    levelPanel: '.raster-level-panel',
    sourcePanel: '.favorite-source-popup'
  };
  const issues = [];
  const groups = {};
  for (const [key, selector] of Object.entries(selectors)) {
    const el = document.querySelector(selector);
    if (visible(el)) groups[key] = box(el);
  }
  function outside(r) {
    return r.x < -.5 || r.y < -.5 || r.x + r.w > innerWidth + .5 || r.y + r.h > innerHeight + .5;
  }
  for (const [name, r] of Object.entries(groups)) if (outside(r)) issues.push('outside:' + name);
  const controls = [...document.querySelectorAll('.home-position-dock .position-dock-button,.home-map-actions>button')].filter(visible);
  for (const el of controls) {
    const b = box(el);
    const name = el.getAttribute('aria-label');
    const target = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
    if (!el.contains(target)) issues.push('miss:' + name);
    if (b.w < 43.8 || b.h < 43.8) issues.push('small:' + name);
    if (outside(b)) issues.push('outside:' + name);
  }
  for (const [i, [a, r]] of Object.entries(groups).entries()) for (const [b, s] of Object.entries(groups).slice(i + 1)) {
    const w = Math.min(r.x + r.w, s.x + s.w) - Math.max(r.x, s.x),
      h = Math.min(r.y + r.h, s.y + s.h) - Math.max(r.y, s.y);
    if (w > .8 && h > .8) issues.push('overlap:' + a + '/' + b + ' ' + Math.round(w) + 'x' + Math.round(h));
  }
  return {
    actual: [innerWidth, innerHeight],
    groups,
    buttons: controls.length,
    issues
  };
}
try {
  // Replay the delivery CSS on an isolated browser page for the negative control.
  // The development server and the working tree continue serving the user's preview.
  if (phase === 'before') {
    for (const file of ['modules/controls/outdoorTheme.css', 'modules/section/survey.css', 'modules/mapComparison/mapComparison.css']) {
      const original = execFileSync('git', ['show', '2cf68bf:' + file], { encoding: 'utf8' });
      await page.route('**/' + file + '*', async route => {
        const response = await route.fetch();
        const module = await response.text();
        const definition = /const __vite__css = [^\n]+/;
        if (!definition.test(module)) throw new Error('Missing CSS module for ' + file);
        const body = module.replace(definition, () => 'const __vite__css = ' + JSON.stringify(original));
        await route.fulfill({ response, body });
      });
    }
  }
  await page.goto('http://127.0.0.1:9174/', {
    waitUntil: 'domcontentloaded'
  });
  await page.locator('.home-position-dock button').first().waitFor({
    timeout: 45000
  });
  await page.locator('.maplibregl-ctrl-scale').first().waitFor({
    state: 'visible',
    timeout: 20000
  });
  for (const [width, height] of unique) {
    await page.setViewportSize({
      width,
      height
    });
    await frames();
    const result = await page.evaluate(measure);
    result.requested = [width, height];
    if (result.actual[0] !== width || result.actual[1] !== height) throw new Error('Unexpected viewport ' + result.actual);
    if (phase !== 'before' && (result.buttons !== 9 || ['rail', 'actions', 'footer', 'scale', 'joystick'].some(name => !result.groups[name]))) throw new Error('Missing core controls at ' + result.actual);
    results.push(result);
    const isSample = [[960, 600], [1024, 601], [390, 857], [780, 360]].some(([w, h]) => w === width && h === height);
    if (isSample) await page.screenshot({
      path: path.join(output, 'home-' + width + 'x' + height + '.png')
    });
    if (phase === 'before' || !isSample) continue;
    if (result.issues.some(x => x.startsWith('miss:'))) {
      result.issues.push('Popup interaction blocked by overlapping rail');
      continue;
    }
    const level = page.locator('.raster-level-control>.position-dock-button');
    if (!(await level.isVisible())) throw new Error('Missing level entry at ' + result.actual);
    await level.click({
      timeout: 12000
    });
    await frames();
    result.level = await page.evaluate(measure);
    if (!result.level.groups.levelPanel) result.issues.push('level failed to open');
    if (width === 960) await page.screenshot({
      path: path.join(output, 'level-960x600.png')
    });
    await page.getByRole('button', {
      name: '关闭图层层级'
    }).click({
      timeout: 12000
    });
    await page.locator('.raster-level-panel').waitFor({
      state: 'hidden'
    });
    await page.locator('.favorite-source-trigger').click({
      timeout: 12000
    });
    await frames();
    result.sources = await page.evaluate(measure);
    if (!result.sources.groups.sourcePanel) result.issues.push('sources failed to open');
    await page.locator('.favorite-source-trigger').click({
      timeout: 12000
    });
    await page.locator('.favorite-source-popup').waitFor({
      state: 'hidden'
    });
  }
} finally {
  await writeFile(path.join(output, 'matrix.json'), JSON.stringify(results, null, 2));
  await browser.close();
}
const failed = results.filter(s => s.issues.length || s.level?.issues.length || s.sources?.issues.length);
console.log(JSON.stringify({
  total: results.length,
  failed: failed.length,
  examples: failed.slice(0, 5).map(s => ({
    actual: s.actual,
    issues: s.issues,
    level: s.level?.issues,
    sources: s.sources?.issues
  }))
}, null, 2));
process.exitCode = Number(failed.length > 0);
