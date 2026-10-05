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
  clouds: false,
  rain: false,
  temperature: false,
  roads: true,
  roadsOpacity: 0.75,
  labels: true,
  opacity: 0.6,
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

test('layer window renders all ten standard switches and the roads slider callback', async (t) => {
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
  assert.equal(switches.length, 10);
  for (const key of ['clouds', 'temperature', 'terrain', 'satellite', 'elevationColors', 'contours', 'geology', 'roads', 'labels', 'rain']) {
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

test('custom source hides satellite but retains cloud observation and nine other switches', async (t) => {
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
  assert.equal(switches.length, 9);
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
  assert.ok(changes.some(patch => patch.terrain === true && patch.rain === false && patch.contours === true));

  await React.act(async () => document.querySelector('[aria-label="关闭图层窗口"]').click());
  assert.deepEqual(openStates, [false]);
});

test('cloud controls expose observation time, errors and zero opacity independently of basemap', async t => {
  const { React, root, LayerWindow } = await renderHarness(t);
  const changes = [];
  await React.act(async () => root.render(React.createElement(LayerWindow, {
    open: true, onOpen() {}, settings: settings({clouds:true}), onChange: patch => changes.push(patch),
    onOpenSources() {}, customSource:'自定义地图', mapStatus:'ready',
    cloudState:{loading:false,ready:true,error:'',frame:{stamp:'202610030600',timeUTC:Date.UTC(2026,9,3,6)},frames:[{stamp:'202610030500',timeUTC:Date.UTC(2026,9,3,5)}]},
  })));
  assert.match(document.querySelector('[aria-label="卫星云图状态"]').textContent, /14:00.*北京时间/);
  await React.act(async () => renderedProps(document.getElementById('cloud-opacity')).onChange({target:{value:'0'}}));
  await React.act(async () => renderedProps(document.getElementById('cloud-time')).onChange({target:{value:'202610030500'}}));
  assert.deepEqual(changes,[{cloudOpacity:0},{cloudTime:'202610030500'}]);
  assert.equal(document.getElementById('satellite-toggle'), null);
  assert.ok(document.getElementById('clouds-toggle'));
});
