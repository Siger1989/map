import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

async function loadProfile() {
  await build({
    entryPoints: ['modules/routeDisplay/RouteElevationProfile.tsx'],
    outdir: '.openai/rally-elevation-profile-test',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    logLevel: 'silent',
  });
  return (await import('../.openai/rally-elevation-profile-test/RouteElevationProfile.js')).RouteElevationProfile;
}

test('compact navigation profile tracks wide and narrow columns without stretching labels or changing fill opacity', async t => {
  const { window } = parseHTML('<html><body></body></html>');
  let containerWidth = 320;
  const observers = [];
  class ResizeObserverStub {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; this.trigger(); }
    trigger() { this.callback([{ target: this.target, contentRect: { width: containerWidth, height: 52 } }]); }
    disconnect() {}
  }
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
    resizeObserver: globalThis.ResizeObserver,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: ResizeObserverStub,
  });
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const RouteElevationProfile = await loadProfile();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => {
    await act(async () => root.unmount());
    for (const key of ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT', 'ResizeObserver']) {
      if (old[key] === undefined) delete globalThis[key];
      else globalThis[key] = old[key];
    }
  });

  const samples = [
    { distance: 0, elevation: 100, part: 0 },
    { distance: 1000, elevation: 180, part: 0 },
  ];
  const common = { samples, scale: { min: 100, max: 180 } };
  await act(async () => root.render(React.createElement(RouteElevationProfile, { ...common, compact: true, progress: 500 })));

  const compactSvg = host.querySelector('svg');
  const assertWidth = width => {
    const [minX, minY, viewWidth, viewHeight] = compactSvg.getAttribute('viewBox').split(/\s+/).map(Number);
    assert.deepEqual([minX, minY], [0, 0]);
    assert.equal(viewWidth, width, 'the viewBox follows the measured SVG width');
    assert.equal(viewHeight, 52, 'compact viewBox keeps its original height and matches CSS height');
    assert.equal(compactSvg.hasAttribute('preserveAspectRatio'), false, 'default aspect-ratio handling keeps text undistorted');
    assert.equal(host.querySelector('[aria-label="路线海拔剖面，全长 1.0 公里"] text:nth-of-type(2)')?.getAttribute('x'), String(width - 4));
    const routeSegment = [...compactSvg.querySelectorAll('path')].find(path => path.getAttribute('stroke-width') === '2');
    assert.ok(routeSegment.getAttribute('d').endsWith(`L${width - 4} 12`), 'route endpoint lands four user units from the measured right edge');
  };
  assertWidth(320);
  assert.equal(host.querySelector('[aria-label="已行路线海拔填充"]')?.getAttribute('fill-opacity'), '0.22', 'progress fill keeps its existing transparency');

  containerWidth = 180;
  await act(async () => observers[0].trigger());
  assertWidth(180);

  await act(async () => root.render(React.createElement(RouteElevationProfile, common)));
  assert.equal(host.querySelector('svg').getAttribute('viewBox'), '0 0 180 74', 'regular profile keeps its original fixed viewBox');
});
