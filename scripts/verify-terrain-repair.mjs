// Run against the local dev server; map instrumentation is isolated to this browser.
import { browserRuntime } from './browser-runtime.mjs';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
const browser = await browserRuntime().chromium.launch({
  headless: true,
  executablePath: process.env.MAP_BROWSER_PATH || undefined,
});
const timer = setTimeout(() => { console.error('Terrain verification timed out'); process.exit(1); }, 180000);
try {
  await mkdir('artifacts/screenshots', { recursive: true });
  for (const [width, height] of [[780, 844], [390, 844], [360, 780]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.route('**/modules/map/TerrainMap.tsx*', async route => {
      const response = await route.fetch();
      const body = (await response.text()).replace('mapRef.current = map', 'window.__repairMap = map; mapRef.current = map');
      await route.fulfill({ response, body });
    });
    await page.goto('http://localhost:3000/#13.64/34.85086/97.76257/0/80', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__repairMap?.queryTerrainElevation([97.76257, 34.85086]) > 4200, null, { timeout: 45000 });
    await page.waitForTimeout(5000);
    const samples = await page.evaluate(async () => {
      const m = window.__repairMap;
      const points = [[210, 236], [210, 237]].map(([px, py]) => [
        (3160 + (px + .5) / 256) / 4096 * 360 - 180,
        Math.atan(Math.sinh(Math.PI * (1 - 2 * (1624 + (py + .5) / 256) / 4096))) * 180 / Math.PI,
      ]);
      const { readElevation } = await import('/modules/terrain/elevation.ts');
      return {
        pitch: m.getPitch(), terrain: m.getTerrain(),
        center: m.queryTerrainElevation(m.getCenter()),
        mesh: points.map(p => m.queryTerrainElevation(p)),
        picker: await Promise.all(points.map(p => readElevation(...p, new AbortController().signal))),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(samples.pitch, 80);
    assert.equal(samples.terrain.exaggeration, 1);
    for (const value of [...samples.mesh, ...samples.picker]) assert.ok(value > 4250 && value < 4350, JSON.stringify(samples));
    assert.deepEqual(samples.picker, [4275.75, 4288.75]);
    assert.equal(samples.overflow, false);
    await page.waitForFunction(() => {
      const map = window.__repairMap;
      return map?.getCanvas().isConnected && map.getPitch() === 80 &&
        document.querySelector('.camera-gizmo')?.textContent?.includes('80');
    }, null, { timeout: 15000 });
    await page.screenshot({ path: `artifacts/screenshots/terrain-spikes-after-${width}.png` });
    // Same-origin resolver returns exactly the attributed repair, not the old cached redirect.
    const response = await page.request.get('http://localhost:3000/api/terrain/12/3160/1624.png?revision=repairs-v1');
    assert.equal(response.status(), 200);
    assert.deepEqual(await response.body(), await readFile('public/terrain/repairs-v1/12/3160/1624.png'));
    assert.ok(response.url().includes('/terrain/repairs-v1/'));
    if (width === 390) {
      // Levels which used to contain the defect now resolve to the same repair pyramid.
      for (const z of [11, 12, 14]) {
        await page.evaluate(z => window.__repairMap.jumpTo({ zoom: z, pitch: 55 }), z);
        await page.waitForTimeout(1600);
        assert.ok(await page.evaluate(() => window.__repairMap.queryTerrainElevation([97.76257, 34.85086]) > 4200));
      }
      const original = await page.request.get('http://localhost:3000/api/terrain/12/3219/1676.png?revision=repairs-v1', { maxRedirects: 0 });
      assert.equal(original.headers().location, 'http://localhost:3000/terrain/fabdem-v1-2/12/3219/1676.png');
      const outside = await page.request.get('http://localhost:3000/api/terrain/12/3162/1624.png?revision=repairs-v1', { maxRedirects: 0 });
      assert.equal(outside.headers().location, 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium/12/3162/1624.png');
    }
    assert.deepEqual(errors, []);
    console.log('PASS', width, height, JSON.stringify(samples));
    await page.close();
  }
} finally { clearTimeout(timer); await browser.close(); }
