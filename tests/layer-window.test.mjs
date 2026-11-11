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
  await build({
    entryPoints: ['modules/geology/GeologyPanel.tsx'],
    outfile: '.openai/layer-window-test/GeologyPanel.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    plugins: [cssStub],
  });
  await build({
    entryPoints: ['modules/mapComparison/ComparisonLayerWindow.tsx'],
    outfile: '.openai/layer-window-test/ComparisonLayerWindow.js',
    bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic', plugins: [cssStub],
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { LayerWindow } = await import('../.openai/layer-window-test/LayerWindow.js');
  const { GeologyPanel } = await import('../.openai/layer-window-test/GeologyPanel.js');
  const { ComparisonLayerWindow } = await import('../.openai/layer-window-test/ComparisonLayerWindow.js');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  return { React, root, LayerWindow, GeologyPanel, ComparisonLayerWindow };
}

function renderedProps(element) {
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  assert.ok(propsKey, 'element was rendered by React');
  return element[propsKey];
}

test('layer window renders the eight map switches and the roads slider callback', async (t) => {
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
  assert.equal(switches.length, 8);
  for (const key of ['terrain', 'satellite', 'elevationColors', 'contours', 'outdoorContours', 'geology', 'roads', 'labels']) {
    const toggle = document.getElementById(`${key}-toggle`);
    assert.ok(toggle, `missing ${key} switch`);
    assert.ok(toggle.getAttribute('aria-labelledby'));
  }
  assert.equal(document.querySelector('.layer-presets'), null, 'preset slot is hosted with the layer help');
  assert.ok(document.querySelector('.layer-help'));

  assert.equal(document.querySelector('.layer-display-settings'), null, 'no detached all-layer parameters menu');
  const displayParameters = document.getElementById('roads-parameters');
  assert.ok(displayParameters.closest('[data-layer="roads"]'), 'roads parameters belong to the roads row');
  assert.equal(displayParameters.hidden, true, 'parameters start collapsed');
  const roadsSlider = document.getElementById('roads-opacity');
  assert.ok(roadsSlider);
  await React.act(async () => document.querySelector('[aria-controls="roads-parameters"]').click());
  assert.equal(displayParameters.hidden, false);
  assert.deepEqual(changes, [], 'opening a parameter group does not change map settings');
  await React.act(async () => renderedProps(roadsSlider).onChange({ target: { value: '0.4' } }));
  assert.ok(changes.some(patch => patch.roadsOpacity === 0.4), 'rendered roads slider reports opacity through onChange');
});

test('custom source hides satellite but retains the seven applicable map switches', async (t) => {
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
  assert.equal(switches.length, 7);
  assert.equal(document.getElementById('satellite-toggle'), null);
  assert.ok(document.getElementById('roads-toggle'));
  assert.ok(document.getElementById('labels-toggle'));
});

test('geology layer controls keep opacity and legend access without a Cloud source selector', async (t) => {
  const { React, root, LayerWindow } = await renderHarness(t);
  await React.act(async () => root.render(React.createElement(LayerWindow, {
    open: true,
    onOpen() {},
    settings: settings({ geology: true, geologySource: 'geocloud20w' }),
    onChange() {},
    onOpenSources() {},
    onGeologyDetails() {},
    mapStatus: 'ready',
  })));
  assert.ok(document.getElementById('geology-opacity'));
  assert.ok(document.querySelector('.layer-geology-detail'), 'the global geology legend remains reachable');
  assert.equal(document.querySelector('.geology-source-choice'), null);
  assert.equal(document.body.textContent.includes('地质云'), false);
  assert.equal(document.body.textContent.includes('1∶20'), false);
});

test('geology details cannot expose an authorization prompt or stale Cloud state', async (t) => {
  const { React, root, GeologyPanel } = await renderHarness(t);
  await React.act(async () => root.render(React.createElement(GeologyPanel, {
    state: {
      source: 'geocloud20w', status: 'authorization', message: '地质云需要授权',
      serviceTitle: '1∶20 万地质图', legendUrl: '/api/geology/geocloud?request=legend',
      legend: [], sources: [], selection: null, cursorSelection: null,
    },
    source: 'geocloud20w',
    onSource() { throw new Error('source selection must not be available'); },
    onRetry() { throw new Error('Cloud retry must not be available'); },
  })));
  assert.match(document.body.textContent, /全球地质/);
  assert.equal(document.body.textContent.includes('地质云'), false);
  assert.equal(document.body.textContent.includes('1∶20'), false);
  assert.equal(document.querySelector('.geology-source-choice'), null);
  assert.equal(document.querySelector('.geology-cloud-info'), null);
  assert.equal(document.querySelector('img.geology-provider-legend'), null);
});

test('layer help has no joint terrain-and-contour preset and close reports closed state', async (t) => {
  const { React, root, LayerWindow } = await renderHarness(t);
  const openStates = [];
  await React.act(async () => root.render(React.createElement(LayerWindow, {
    open: true,
    onOpen: value => openStates.push(value),
    settings: settings(),
    onChange() {},
    onOpenSources() {},
    mapStatus: 'ready',
  })));

  const help = document.querySelector('.layer-help');
  assert.ok(help);
  assert.equal(help.hasAttribute('open'), false);
  assert.equal(help.querySelector('[aria-label="观察模式"]'), null, 'the joint 3D terrain and contour preset is removed');
  const allDetails = [...document.querySelectorAll('details')];
  assert.equal(allDetails.length, 1, 'only shared source help stays in the footer');
  assert.ok(document.getElementById('terrain-toggle'), 'the independent terrain switch remains available');
  assert.ok(document.getElementById('contours-toggle'), 'the independent contour switch remains available');

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


test('each parameter group follows its layer and opening another preserves existing values', async t => {
  const { React, root, LayerWindow } = await renderHarness(t);
  const changes = [];
  let legends = 0;
  await React.act(async () => root.render(React.createElement(LayerWindow, {
    open: true, onOpen() {}, settings: settings({ contours: true, elevationColors: true, geology: true }),
    onChange: patch => changes.push(patch), onOpenSources() {},
    onGeologyDetails: () => legends++, mapStatus: 'ready',
  })));
  for (const [key, id] of [['terrain', 'terrain-exaggeration'], ['elevationColors', 'elevation-colors-opacity'], ['contours', 'contour-interval'], ['geology', 'geology-opacity'], ['roads', 'roads-opacity']]) {
    assert.equal(document.getElementById(id).closest('.layer-item').getAttribute('data-layer'), key);
    assert.ok(document.querySelector(`[data-layer="${key}"] [aria-controls="${key}-parameters"]`));
  }
  assert.equal(document.querySelector('[data-layer="satellite"] .imagery-selector').getAttribute('aria-label'), '卫星影像类型');
  assert.equal(document.querySelector('[data-layer="outdoorContours"] .layer-parameters-toggle'), null, 'no empty settings entry');
  assert.equal(document.querySelector('[data-layer="labels"] .layer-parameters-toggle'), null, 'no invented independent label opacity');
  await React.act(async () => document.querySelector('[aria-controls="terrain-parameters"]').click());
  assert.equal(document.getElementById('terrain-parameters').hidden, false);
  await React.act(async () => document.querySelector('[aria-controls="geology-parameters"]').click());
  assert.equal(document.getElementById('terrain-parameters').hidden, true, 'only one inline group is expanded');
  assert.equal(document.getElementById('geology-parameters').hidden, false);
  assert.equal(document.getElementById('terrain-exaggeration').getAttribute('value'), '1.2');
  assert.deepEqual(changes, [], 'disclosures never rewrite stored layer preferences');
  const legend = document.querySelector('[data-layer="geology"] .layer-geology-detail');
  await React.act(async () => legend.click());
  assert.equal(legends, 1, 'legend remains reachable inside geology parameters');
  await React.act(async () => renderedProps(document.getElementById('contour-interval')).onChange({ target: { value: '100' } }));
  assert.deepEqual(changes, [{ contourInterval: 100 }]);
});


test('comparison inline settings change only the selected pane and retain values across pane switches', async t => {
  const { React, root, ComparisonLayerWindow } = await renderHarness(t);
  const initial = [settings({ roadsOpacity: 0.75 }), settings({ roadsOpacity: 0.9, exaggeration: 1.5 })];
  let current;
  function Harness() {
    const [pane, setPane] = React.useState(0);
    const [values, setValues] = React.useState(initial);
    current = values;
    return React.createElement(ComparisonLayerWindow, {
      pane, onPane: setPane, choice: { name: '内置地图', settings: values[pane] },
      side: index => index === 0 ? '上' : '下',
      onChange: patch => setValues(previous => previous.map((value, index) => index === pane ? { ...value, ...patch } : value)),
      onSource() {}, onClose() {}, status: 'ready',
    });
  }
  await React.act(async () => root.render(React.createElement(Harness)));
  await React.act(async () => document.querySelector('[aria-controls="roads-parameters"]').click());
  assert.equal(document.getElementById('roads-parameters').hidden, false);
  await React.act(async () => renderedProps(document.getElementById('roads-opacity')).onChange({ target: { value: '0.4' } }));
  assert.equal(current[0].roadsOpacity, 0.4);
  assert.equal(current[1].roadsOpacity, 0.9);
  await React.act(async () => document.querySelector('.comparison-layer-tabs button:nth-child(2)').click());
  assert.equal(document.getElementById('roads-parameters').hidden, true, 'new pane starts with closed parameter groups');
  await React.act(async () => document.querySelector('[aria-controls="terrain-parameters"]').click());
  await React.act(async () => renderedProps(document.getElementById('terrain-exaggeration')).onChange({ target: { value: '1.8' } }));
  assert.equal(current[0].exaggeration, 1.2);
  assert.equal(current[1].exaggeration, 1.8);
  await React.act(async () => document.querySelector('.comparison-layer-tabs button:nth-child(1)').click());
  assert.equal(document.getElementById('roads-opacity').getAttribute('value'), '0.4');
  assert.equal(document.querySelector('.layer-display-settings'), null);
});

test('geology detail returns to the mounted parent group and scroll; Escape backs once before closing', async t => {
  const { React, root, LayerWindow } = await renderHarness(t);
  const changes = [];
  let closed = 0, returned = 0;
  function Harness() {
    const [detail, setDetail] = React.useState(false);
    const [open, setOpen] = React.useState(true);
    return React.createElement(LayerWindow, {
      open, onOpen: value => { closed++; setOpen(value); },
      settings: settings({ geology: true }), onChange: patch => changes.push(patch),
      onOpenSources() {}, mapStatus: 'ready',
      detail: detail ? React.createElement('div', { 'aria-label': '测试地质图例' }, '图例内容') : undefined,
      onGeologyDetails: () => setDetail(true),
      onDetailBack: () => { returned++; setDetail(false); },
    });
  }
  await React.act(async () => root.render(React.createElement(Harness)));
  await React.act(async () => document.querySelector('[aria-controls="geology-parameters"]').click());
  const parent = document.querySelector('.layer-parent-page');
  const parameters = document.getElementById('geology-parameters');
  const panel = document.querySelector('.layer-panel');
  const scroll = document.querySelector('.dock-content');
  scroll.scrollTop = 176;
  await React.act(async () => document.querySelector('.layer-geology-detail').click());
  assert.equal(parent.hidden, true);
  assert.equal(parent.hasAttribute('inert'), true, 'hidden parent cannot receive keyboard interaction');
  assert.equal(parent.style.display, 'none', 'parent controls have no hit rectangles');
  assert.equal(parent.getAttribute('aria-hidden'), 'true');
  assert.equal(scroll.scrollTop, 0, 'detail starts at its own top');
  scroll.scrollTop = 24;
  await React.act(async () => renderedProps(scroll).onScroll({ currentTarget: scroll }));
  const escape = () => renderedProps(document.querySelector('.map-layer-control')).onKeyDown({
    key: 'Escape', preventDefault() {}, stopPropagation() {},
  });
  await React.act(async () => escape());
  assert.equal(returned, 1);
  assert.equal(closed, 0, 'Escape from detail does not dismiss the layer window');
  assert.equal(document.querySelector('.layer-panel'), panel, 'parent stays mounted');
  assert.equal(document.getElementById('geology-parameters'), parameters);
  assert.equal(parameters.hidden, false, 'expanded layer survives the round trip');
  assert.equal(parent.hidden, false);
  assert.equal(parent.hasAttribute('inert'), false);
  assert.equal(scroll.scrollTop, 176, 'parent scroll is restored, not replaced by detail scroll');
  await React.act(async () => document.querySelector('.layer-geology-detail').click());
  await React.act(async () => document.querySelector('[aria-label="返回图层设置"]').click());
  assert.equal(returned, 2);
  assert.equal(scroll.scrollTop, 176);
  assert.equal(parameters.hidden, false);
  assert.deepEqual(changes, [], 'returning never changes layer preferences');
  await React.act(async () => escape());
  assert.equal(closed, 1, 'Escape at root closes the window');
  assert.equal(document.getElementById('map-layer-window'), null);
});
