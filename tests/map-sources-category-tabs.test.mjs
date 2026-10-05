import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

async function loadPanel() {
  await build({
    entryPoints: ['modules/mapSources/MapSourcesPanel.tsx'],
    outdir: '.openai/map-sources-category-tabs-test',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'offline-reader-stub',
      setup(builder) {
        builder.onResolve({ filter: /offlineClient$/ }, args => ({ path: args.path, namespace: 'offline-stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'offline-stub' }, () => ({ contents: 'export async function inspectOffline() {}', loader: 'js' }));
      },
    }],
    logLevel: 'silent',
  });
  return (await import('../.openai/map-sources-category-tabs-test/MapSourcesPanel.js')).MapSourcesPanel;
}

test('built-in, saved and public source tabs switch directly inside one panel', async t => {
  const { window } = parseHTML('<html><body><div class="dock-content"></div></body></html>');
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const MapSourcesPanel = await loadPanel();
  const mount = document.querySelector('.dock-content');
  let root = createRoot(mount);
  const navigation = [];
  const sources = {
    maps: [], selected: '', source: null, ready: true, status: '',
    select() {}, async add() { return {}; }, async remove() {},
  };
  const render = () => act(async () => root.render(React.createElement(MapSourcesPanel, {
    sources,
    builtin: 'terrain',
    onBuiltin() {},
    onFocus() {},
    onNavigation: value => navigation.push(value),
  })));
  const click = async selector => act(async () => mount.querySelector(selector).click());
  t.after(async () => {
    await act(async () => root.unmount());
    for (const key of ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (old[key] === undefined) delete globalThis[key];
      else globalThis[key] = old[key];
    }
  });

  await render();
  assert.equal(mount.querySelector('.map-sources').getAttribute('data-category'), 'builtin');
  assert.equal(mount.querySelectorAll('.map-source-tabs button').length, 3);
  assert.ok(mount.querySelector('.map-source-builtins'));

  mount.scrollTop = 73;
  await click('.map-source-tabs [data-group="public"]');
  assert.equal(mount.scrollTop, 73, 'switching category preserves the shared panel scroll position');
  assert.equal(mount.querySelector('.map-sources').getAttribute('data-step'), 'list', 'public stays in the shared list step');
  assert.equal(mount.querySelector('.map-sources').getAttribute('data-category'), 'library');
  assert.equal(mount.querySelectorAll('.map-source-tabs button').length, 3, 'all three tabs stay visible in public');
  assert.equal(mount.querySelector('.map-source-tabs [data-group="public"]').getAttribute('aria-pressed'), 'true');
  assert.ok(mount.querySelector('.free-map-library'));
  assert.equal([...mount.querySelectorAll('button')].some(button => button.textContent.trim() === '返回图源选择'), false, 'no extra public-library return layer is inserted');
  assert.equal(navigation.at(-1), null, 'direct tab switching does not open parent navigation');

  await click('.free-map-tabs button:nth-child(3)');
  assert.equal(mount.querySelector('.free-map-tabs button:nth-child(3)').getAttribute('aria-pressed'), 'true', 'public-region choice remains available');
  await click('.map-source-tabs [data-group="saved"]');
  assert.ok(mount.querySelector('.saved-map-sources'));
  assert.equal(mount.querySelectorAll('.map-source-tabs button').length, 3);
  await click('.map-source-tabs [data-group="builtin"]');
  assert.ok(mount.querySelector('.map-source-builtins'));
  await click('.map-source-tabs [data-group="public"]');
  assert.equal(mount.querySelectorAll('.map-source-tabs button').length, 3);
  assert.equal(mount.querySelector('.free-map-tabs button:nth-child(3)').getAttribute('aria-pressed'), 'true', 'public library category survives direct tab round trips');

  await act(async () => root.unmount());
  root = createRoot(mount);
  await render();
  assert.equal(mount.querySelector('.map-sources').getAttribute('data-category'), 'library', 'public tab selection survives panel remount');
  assert.equal(mount.querySelectorAll('.map-source-tabs button').length, 3);
});
