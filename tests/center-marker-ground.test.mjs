import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

test('center marker uses live native ground, prevents duplicate pending picks, and respects sky and selected points', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const saved = Object.fromEntries(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, globalThis[key]]));
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  await build({ entryPoints: ['modules/map/CenterCursor.tsx'], outfile: '.openai/center-marker-test.js', bundle: true,
    platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' } });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { CenterMarkButton } = await import('../.openai/center-marker-test.js');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  });
  const added = [];
  let calls = 0, resolve;
  const handle = {
    centerCoordinate: () => null,
    centerCoordinateAsync: () => { calls++; return new Promise(done => { resolve = done; }); },
  };
  const render = async target => React.act(async () => root.render(React.createElement(CenterMarkButton, {
    map: () => handle, target, onAdd: coordinate => added.push(coordinate),
  })));
  const click = async () => React.act(async () => document.querySelector('.center-add').dispatchEvent(new window.Event('click', { bubbles: true })));
  await render();
  await click(); await click();
  assert.equal(calls, 1, 'one pending native pick cannot create duplicate markers');
  assert.equal(document.querySelector('.center-error'), null, 'a missing local DEM is not immediately reported as missing ground');
  await React.act(async () => resolve([103.923, 1.333]));
  assert.deepEqual(added, [[103.923, 1.333]]);
  await click();
  await React.act(async () => resolve(null));
  assert.match(document.querySelector('.center-error').textContent, /暂无可选地面/);
  assert.equal(added.length, 1, 'a real sky/missing-ground pick never invents coordinates');
  await render([105, 29]); await click();
  assert.equal(calls, 2, 'an explicitly selected route point has priority over the reticle');
  assert.deepEqual(added.at(-1), [105, 29]);
});
