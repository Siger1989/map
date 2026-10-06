import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const settings = (overrides = {}) => ({
  terrain: true,
  satellite: true,
  contours: false,
  elevationColors: false,
  elevationColorsOpacity: 0.8,
  geology: false,
  geologySource: 'world',
  geologyOpacity: 0.85,
  roads: true,
  roadsOpacity: 0.75,
  labels: true,
  exaggeration: 1.2,
  imageryMode: 'detail',
  ...overrides,
});

async function renderHarness(t) {
  const { window } = (await import('linkedom')).parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const cssStub = {
    name: 'ignore-css',
    setup(buildApi) {
      buildApi.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
    },
  };
  await build({
    entryPoints: ['modules/controls/LayerWindow.tsx'],
    outfile: '.openai/layer-window-test/LayerWindow.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    plugins: [cssStub],
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { LayerWindow } = await import('../.openai/layer-window-test/LayerWindow.js');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return { React, root, LayerWindow };
}

function renderedProps(element) {
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  assert.ok(propsKey, 'element was rendered by React');
  return element[propsKey];
}

test('layer window renders the seven map switches and the roads slider callback', async (t) => {
  const { React, root, LayerWindow } = await renderHarness(t);
  const changes = [];
  await React.act(async () => root.render(React.createElement(LayerWindow, {
    open: true,
    onOpen() {},
    settings: settings(),
    onChange: patch => changes.push(patch),
    onOpenSources() {},
    mapStatus: 'ready',
  })));

  const switches = [...document.querySelectorAll('[role="switch"]')];
  assert.equal(switches.length, 7);
  for (const key of ['terrain', 'satellite', 'elevationColors', 'contours', 'geology', 'roads', 'labels']) {
    const toggle = document.getElementById(`${key}-toggle`);
    assert.ok(toggle, `missing ${key} switch`);
    assert.ok(toggle.getAttribute('aria-labelledby'));
  }
  assert.equal(document.querySelector('.layer-presets'), null, 'preset slot is hosted with the layer help');
  assert.ok(document.querySelector('.layer-help'));

  const displayParameters = [...document.querySelectorAll('details')].find(detail => detail.querySelector('summary')?.textContent.includes('显示参数'));
  assert.ok(displayParameters, 'display parameters are grouped in a details element');
  assert.equal(displayParameters.hasAttribute('open'), false, 'display parameters start collapsed');
  const roadsSlider = document.getElementById('roads-opacity');
  assert.ok(roadsSlider);
  displayParameters.setAttribute('open', '');
  await React.act(async () => renderedProps(roadsSlider).onChange({ target: { value: '0.4' } }));
  assert.ok(changes.some(patch => patch.roadsOpacity === 0.4), 'rendered roads slider reports opacity through onChange');
});

test('custom source hides satellite but retains the six applicable map switches', async (t) => {
  const { React, root, LayerWindow } = await renderHarness(t);
  await React.act(async () => root.render(React.createElement(LayerWindow, {
    open: true,
    onOpen() {},
    settings: settings(),
    onChange() {},
    customSource: '自定义底图',
    onOpenSources() {},
    mapStatus: 'ready',
  })));

  const switches = [...document.querySelectorAll('[role="switch"]')];
  assert.equal(switches.length, 6);
  assert.equal(document.getElementById('satellite-toggle'), null);
  assert.ok(document.getElementById('roads-toggle'));
  assert.ok(document.getElementById('labels-toggle'));
});

test('layer help hosts scene presets and the close button reports closed state', async (t) => {
  const { React, root, LayerWindow } = await renderHarness(t);
  const openStates = [];
  const changes = [];
  await React.act(async () => root.render(React.createElement(LayerWindow, {
    open: true,
    onOpen: value => openStates.push(value),
    settings: settings(),
    onChange: patch => changes.push(patch),
    onOpenSources() {},
    mapStatus: 'ready',
  })));

  const help = document.querySelector('.layer-help');
  assert.ok(help);
  assert.equal(help.hasAttribute('open'), false);
  assert.ok(help.querySelector('[aria-label="观察模式"]'), 'scene presets are provided in the layer-help details');
  const allDetails = [...document.querySelectorAll('details')];
  assert.equal(allDetails.length, 2, 'layer help and display parameters are the two compact disclosures');
  const terrainPreset = [...help.querySelectorAll('button')].find(button => button.textContent.includes('看清地形'));
  assert.ok(terrainPreset);
  await React.act(async () => terrainPreset.click());
  assert.ok(changes.some(patch => patch.terrain === true && patch.contours === true));

  await React.act(async () => document.querySelector('[aria-label="关闭图层窗口"]').click());
  assert.deepEqual(openStates, [false]);
});

test('weather controls and status are absent independently of basemap choice', async t => {
  const { React, root, LayerWindow } = await renderHarness(t);
  await React.act(async () => root.render(React.createElement(LayerWindow, {
    open: true, onOpen() {}, settings: settings(), onChange() {},
    onOpenSources() {}, customSource:'自定义地图', mapStatus:'ready',
  })));
  assert.equal(document.getElementById('satellite-toggle'), null);
  for (const id of ['clouds-toggle', 'temperature-toggle', 'rain-toggle', 'cloud-opacity', 'cloud-time', 'rain-opacity'])
    assert.equal(document.getElementById(id), null, `${id} is removed`);
  assert.equal(document.querySelector('[aria-label="卫星云图状态"]'), null);
});
