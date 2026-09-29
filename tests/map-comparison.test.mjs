import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const counters = { mount: {}, unmount: {}, latest: {}, cameraCalls: {} };
const sources = {
  '../map/TerrainMap': `export type TerrainMapProps = any; export type MapHandle = any;`,
};

async function loadHost() {
  await build({
    entryPoints: ['modules/mapComparison/MapComparisonHost.tsx'],
    outdir: '.openai/map-comparison-test',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'map-comparison-test-stubs',
      setup(api) {
        api.onResolve({ filter: /.*/ }, args => sources[args.path]
          ? { path: args.path, namespace: 'map-comparison-stub' }
          : undefined);
        api.onLoad({ filter: /.*/, namespace: 'map-comparison-stub' }, args => ({
          contents: sources[args.path], loader: 'tsx', resolveDir: process.cwd(),
        }));
      },
    }],
  });
  return (await import('../.openai/map-comparison-test/MapComparisonHost.js')).MapComparisonHost;
}

function setupDom() {
  const { window } = parseHTML('<html><body></body></html>');
  let landscape = false;
  const mediaListeners = new Set();
  window.matchMedia = () => ({
    get matches() { return landscape; },
    addEventListener(_type, listener) { mediaListeners.add(listener); },
    removeEventListener(_type, listener) { mediaListeners.delete(listener); },
  });
  window.setLandscape = value => {
    landscape = value;
    for (const listener of mediaListeners) listener({ matches: landscape });
  };
  Object.assign(globalThis, {
    window, document: window.document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return window;
}

function changeControl(f, element, value) {
  let prototype = Object.getPrototypeOf(element);
  while (prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) { descriptor.set.call(element, value); break; }
    prototype = Object.getPrototypeOf(prototype);
  }
  element.dispatchEvent(new f.window.Event('input', { bubbles: true }));
  element.dispatchEvent(new f.window.Event('change', { bubbles: true }));
}

async function changeReactControl(f, element, value) {
  const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
  const handler = propsKey && element[propsKey]?.onChange;
  if (handler) {
    await f.act(async () => handler({ target: { value }, currentTarget: { value } }));
    return;
  }
  await f.act(async () => changeControl(f, element, value));
}

function makeChoice(id, source, settings, group = '我的图源') {
  return { id, name: id, group, source, settings };
}

function makeFixture(React) {
  for (const key of Object.keys(counters)) counters[key] = {};
  const sourceA = { id: 'source-a' };
  const sourceB = { id: 'source-b' };
  const settingsCurrent = { satellite: false, label: 'current' };
  const settingsA = { satellite: false, label: 'A' };
  const settingsB = { satellite: true, label: 'B' };
  const choices = [
    makeChoice('current', sourceA, settingsCurrent, '当前'),
    makeChoice('sentinel', null, settingsA, '内置'),
    makeChoice('alpha', sourceA, settingsA),
    makeChoice('beta', sourceB, settingsB),
  ];
  const session = { choices, camera: { center: [104, 30], zoom: 9, bearing: 12, pitch: 0 } };
  let nextInstance = 0;
  const MapProbe = React.forwardRef(function MapProbe(props, ref) {
    const [instanceId] = React.useState(() => ++nextInstance);
    const identity = props.className ?? `original-${instanceId}`;
    counters.latest[identity] = props;
    React.useEffect(() => {
      counters.mount[identity] = (counters.mount[identity] ?? 0) + 1;
      return () => { counters.unmount[identity] = (counters.unmount[identity] ?? 0) + 1; };
    }, []);
    React.useImperativeHandle(ref, () => ({
      applyCamera(camera) {
        counters.cameraCalls[identity] ??= [];
        counters.cameraCalls[identity].push(camera);
      },
      centerCoordinate: () => mapCenter,
      cameraSnapshot: () => cameraValue,
      setTerrainMode: enabled => handleCalls.terrain.push([identity, enabled]),
      view: (pitch, bearing, animate) => handleCalls.view.push([identity, pitch, bearing, animate]),
      viewGesture: (pitch, bearing, phase) => handleCalls.viewGesture.push([identity, pitch, bearing, phase]),
      zoom: amount => handleCalls.zoom.push([identity, amount]),
      north: () => { handleCalls.north += 1; },
    }), [identity]);
    return React.createElement('div', { 'data-map': identity });
  });
  const primary = { current: null };
  const used = [];
  const closed = [];
  const marked = [];
  const vertices = [];
  const pauses = [];
  const operationsCalls = { draw: 0, undo: 0, save: 0, locate: 0, drawingMode: null };
  const operationState = { saveResult: true, error: '' };
  const drawingInputs = [];
  let mapCenter = [104.25, 30.75];
  const cameraValue = { center: [104, 30], zoom: 9, bearing: 12, pitch: 0 };
  const handleCalls = { terrain: [], view: [], viewGesture: [], zoom: [], north: 0 };
  const markerState = { current: null, selectCalls: [], updateCalls: [], updateResult: true };
  const styleState = {
    current: { color: '#ff0000', width: 3, opacity: 0.5 },
    calls: [],
  };
  const operations = {
    onMark(point) {
      marked.push(point);
      markerState.current = { id: `new-${marked.length}`, name: '新标记', note: '', color: '#ff0000', coordinates: point };
      return true;
    },
    onDraw() { operationsCalls.draw += 1; },
    onVertex(point) { vertices.push(point); },
    onUndo() { operationsCalls.undo += 1; vertices.pop(); },
    onSave() { operationsCalls.save += 1; return operationState.saveResult; },
    onPause() { pauses.push([...vertices]); },
    onLocate() { operationsCalls.locate += 1; },
    canUndo: true,
    get error() { return operationState.error; },
    get style() { return styleState.current; },
    onStyle(style) { styleState.calls.push(style); styleState.current = style; },
    get marker() { return markerState.current; },
    onSelectMarker(id) {
      markerState.selectCalls.push(id);
      if (markerState.current?.id === id) return true;
      markerState.current = { id, name: '已有标记', note: '旧备注', color: '#00aa00', coordinates: [104, 30] };
      return true;
    },
    onUpdateMarker(id, patch) {
      markerState.updateCalls.push({ id, patch });
      if (!markerState.updateResult) return false;
      markerState.current = { ...markerState.current, ...patch };
      return true;
    },
  };
  const overlays = {
    routeOverlay: { id: 'route-overlay' },
    guidanceOverlay: { id: 'guidance-overlay' },
    trackOverlay: { id: 'track-overlay' },
  };
  const child = React.createElement(MapProbe, { ...overlays, persistCamera: true, settings: settingsCurrent, ref: primary });
  const props = {
    session,
    primary,
    onClose: () => closed.push(true),
    onUse: choice => used.push(choice),
    search: React.createElement('div', { 'data-place-search': true }),
    drawingMode: 'points',
    onDrawingModeChange(mode) { operationsCalls.drawingMode = mode; props.drawingMode = mode; },
    onDrawingInput(index, event) { drawingInputs.push([index, event]); },
    drawingOverlay(index) { return React.createElement('div', { 'data-comparison-overlay': index }); },
    operations,
    children: child,
  };
  return {
    props, session, choices, overlays, used, closed, primary, marked, vertices, pauses,
    operationsCalls, operationState, drawingInputs, mapCenter, cameraValue, handleCalls, markerState, styleState,
    setMapCenter(value) { mapCenter = value; },
  };
}

async function mount(t, sessionOverride) {
  const window = setupDom();
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const MapComparisonHost = await loadHost();
  const fixture = makeFixture(React);
  if (sessionOverride !== undefined) fixture.props.session = sessionOverride;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => act(async () => root.unmount()));
  const render = async session => act(async () => root.render(React.createElement(
    MapComparisonHost, { ...fixture.props, session },
  )));
  await render(fixture.props.session);
  return { ...fixture, React, act, host, render, window };
}

test('keeps the primary map mounted while comparison opens and closes, and removes the secondary map', async t => {
  const f = await mount(t, null);
  assert.equal(Object.values(counters.mount).reduce((sum, value) => sum + value, 0), 1);
  const primaryIdentity = Object.keys(counters.latest).find(name => name.startsWith('original-'));
  await f.render(f.session);
  assert.equal(counters.mount[primaryIdentity], 1, 'changing cloned props does not remount the primary map');
  assert.equal(counters.mount['map-comparison-secondary'], 1);
  await f.render(null);
  assert.equal(counters.mount[primaryIdentity], 1, 'the original map instance remains mounted');
  assert.equal(counters.unmount['map-comparison-secondary'], 1, 'the secondary map is removed on close');
  assert.equal(counters.unmount[primaryIdentity] ?? 0, 0);
  assert.deepEqual(f.used, [], 'closing does not apply either source');
});

test('both panes retain shared route and marker overlays and synchronize camera changes in either direction', async t => {
  const f = await mount(t);
  const upper = counters.latest['map-comparison-primary'];
  const lower = counters.latest['map-comparison-secondary'];
  for (const key of Object.keys(f.overlays)) {
    assert.equal(upper[key], f.overlays[key]);
    assert.equal(lower[key], f.overlays[key]);
  }
  assert.equal(upper.readOnly, false, 'operations keep normal map gestures available');
  assert.equal(lower.readOnly, false);
  assert.equal(upper.pickingActive, true);
  assert.equal(upper.annotationPicking, true, 'existing markers stay selectable in browse mode');
  assert.equal(upper.queryOnPick, false, 'comparison clicks do not trigger the regular elevation query');
  assert.equal(lower.persistCamera, false);
  const fromUpper = { center: [103, 31], zoom: 11, bearing: 30, pitch: 15 };
  await f.act(async () => upper.onCameraChange(fromUpper));
  assert.equal(counters.cameraCalls['map-comparison-secondary'].at(-1), fromUpper);
  const fromLower = { center: [105, 32], zoom: 8, bearing: 270, pitch: 0 };
  await f.act(async () => counters.latest['map-comparison-secondary'].onCameraChange(fromLower));
  assert.equal(counters.cameraCalls['map-comparison-primary'].at(-1), fromLower);
});

test('source stepping changes only that pane, wraps, and does not use or persist a source', async t => {
  const f = await mount(t);
  const upperNext = f.host.querySelector('[aria-label="上图：下一图源"]');
  await f.act(async () => upperNext.click());
  assert.equal(counters.latest['map-comparison-primary'].mapSource, null, 'upper advances from current to sentinel');
  assert.equal(counters.latest['map-comparison-primary'].settings, f.choices[1].settings);
  assert.equal(counters.latest['map-comparison-secondary'].settings, f.choices[1].settings, 'lower stays on sentinel');
  const lowerSelect = f.host.querySelector('[aria-label="下方图源"]');
  Object.defineProperty(lowerSelect, 'value', { configurable: true, value: 'beta' });
  await f.act(async () => lowerSelect.dispatchEvent(new f.window.Event('change', { bubbles: true })));
  assert.equal(counters.latest['map-comparison-secondary'].mapSource, f.choices[3].source);
  assert.equal(counters.latest['map-comparison-primary'].settings, f.choices[1].settings, 'changing lower leaves upper unchanged');
  await f.act(async () => f.host.querySelector('[aria-label="下图：下一图源"]').click());
  assert.equal(counters.latest['map-comparison-secondary'].settings, f.choices[0].settings, 'last choice wraps to first');
  assert.deepEqual(f.used, []);
});

test('Use applies the exact upper or lower choice only when its button is pressed', async t => {
  const f = await mount(t);
  await f.act(async () => f.host.querySelector('[aria-label="使用上方图源"]').click());
  assert.equal(f.used.at(-1), f.choices[0]);
  assert.equal(f.used.length, 1);
  const lower = f.host.querySelector('[aria-label="下方图源"]');
  Object.defineProperty(lower, 'value', { configurable: true, value: 'beta' });
  await f.act(async () => lower.dispatchEvent(new f.window.Event('change', { bubbles: true })));
  await f.act(async () => f.host.querySelector('[aria-label="使用下方图源"]').click());
  assert.equal(f.used.at(-1), f.choices[3]);
  assert.equal(f.used.length, 2);
});

test('Mark creates one pin at the primary map center and opens its properties editor', async t => {
  const f = await mount(t);
  await f.act(async () => [...f.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '标记').click());
  assert.deepEqual(f.marked, [f.mapCenter], 'the click creates a marker once at the live primary center');
  assert.ok(f.host.querySelector('[aria-label="编辑对比标记"]'));
  assert.equal(f.host.querySelector('[aria-label="上图中心十字"]')?.getAttribute('role'), 'img');
  assert.equal(f.host.querySelector('[aria-label="下图中心十字"]')?.getAttribute('role'), 'img');
});

test('selecting an existing marker from either map opens its editor', async t => {
  const f = await mount(t);
  await f.act(async () => counters.latest['map-comparison-primary'].onAnnotationSelect('saved-1'));
  assert.deepEqual(f.markerState.selectCalls, ['saved-1']);
  assert.ok(f.host.querySelector('[aria-label="编辑对比标记"]'));
  await f.act(async () => f.host.querySelector('[aria-label="关闭标记编辑"]').click());
  await f.act(async () => counters.latest['map-comparison-secondary'].onAnnotationSelect('saved-2'));
  assert.deepEqual(f.markerState.selectCalls, ['saved-1', 'saved-2']);
  assert.ok(f.host.querySelector('[aria-label="编辑对比标记"]'));
});

test('draw mode accepts vertices from both maps, supports undo, and stays active on save failure', async t => {
  const f = await mount(t);
  await f.act(async () => [...f.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '画线').click());
  assert.equal(f.operationsCalls.draw, 1);
  assert.equal(counters.latest['map-comparison-primary'].drawingActive, true, 'primary map uses the normal drawing gesture bridge');
  assert.equal(counters.latest['map-comparison-secondary'].drawingActive, true, 'secondary map uses the normal drawing gesture bridge');
  assert.equal(counters.latest['map-comparison-secondary'].pickingActive, false, 'drawing input is not reduced to map clicks');
  assert.equal(f.host.querySelectorAll('[data-comparison-overlay]').length, 2, 'each map gets a viewport-local drawing overlay');
  assert.ok(f.host.querySelector('[data-place-search]'), 'the comparison header keeps a real search element');
  const first = { type: 'start', point: { x: 10, y: 20 } }, second = { type: 'move', point: { x: 30, y: 40 } };
  await f.act(async () => counters.latest['map-comparison-primary'].onDrawingInput(first));
  await f.act(async () => counters.latest['map-comparison-secondary'].onDrawingInput(second));
  assert.deepEqual(f.drawingInputs, [[0, first], [1, second]], 'input reaches the matching pane drawing session');
  f.vertices.push([104.1, 30.5], [104.2, 30.6]); // the pane-local TrackDrawing sessions share the regular route draft
  await f.act(async () => f.host.querySelector('.map-comparison-drawing-mode button[aria-pressed="false"]').click());
  await f.render(f.session);
  assert.equal(f.operationsCalls.drawingMode, 'freehand', 'the compact mode row selects the existing freehand mode');
  await f.act(async () => [...f.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '撤销').click());
  assert.equal(f.operationsCalls.undo, 1);
  assert.deepEqual(f.vertices, [[104.1, 30.5]]);
  f.operationState.saveResult = false;
  f.operationState.error = '保存失败，路线草稿已保留';
  await f.render(f.session);
  await f.act(async () => [...f.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '保存').click());
  assert.equal(f.operationsCalls.save, 1);
  assert.ok([...f.host.querySelectorAll('.map-comparison-actions button')].some(button => button.textContent === '暂停'), 'failed save keeps drawing active');
  assert.deepEqual(f.vertices, [[104.1, 30.5]], 'failed save keeps the remaining draft point');
  assert.equal(f.host.querySelector('[role="alert"]')?.textContent, f.operationState.error);
  f.operationState.saveResult = true;
  f.operationState.error = '';
  await f.render(f.session);
  await f.act(async () => [...f.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '保存').click());
  assert.equal(f.operationsCalls.save, 2);
  assert.equal([...f.host.querySelectorAll('.map-comparison-actions button')].some(button => button.textContent === '暂停'), false, 'successful save exits drawing mode');
});

test('comparison pane names follow portrait and landscape orientation', async t => {
  const f = await mount(t);
  assert.ok(f.host.querySelector('[aria-label="上方地图"]'));
  await f.act(async () => f.window.setLandscape(true));
  assert.ok(f.host.querySelector('[aria-label="左方地图"]'));
  assert.ok(f.host.querySelector('[aria-label="右方地图"]'));
});

test('leaving comparison or choosing a source pauses drawing and preserves the draft', async t => {
  const closeFixture = await mount(t);
  await closeFixture.act(async () => [...closeFixture.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '画线').click());
  const closePoint = [103.5, 30.5];
  closeFixture.vertices.push(closePoint);
  await closeFixture.act(async () => counters.latest['map-comparison-secondary'].onDrawingInput({ type: 'end', reason: 'release' }));
  await closeFixture.act(async () => closeFixture.host.querySelector('[aria-label="退出双图源对比"]').click());
  assert.deepEqual(closeFixture.pauses, [[closePoint]], 'exit pauses without clearing the draft');
  assert.deepEqual(closeFixture.closed, [true]);
  assert.equal(closeFixture.operationsCalls.save, 0);

  const useFixture = await mount(t);
  await useFixture.act(async () => [...useFixture.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '画线').click());
  const usePoint = [105.5, 31.5];
  useFixture.vertices.push(usePoint);
  await useFixture.act(async () => counters.latest['map-comparison-primary'].onDrawingInput({ type: 'end', reason: 'release' }));
  const lower = useFixture.host.querySelector('[aria-label="下方图源"]');
  Object.defineProperty(lower, 'value', { configurable: true, value: 'beta' });
  await useFixture.act(async () => lower.dispatchEvent(new useFixture.window.Event('change', { bubbles: true })));
  await useFixture.act(async () => useFixture.host.querySelector('[aria-label="使用下方图源"]').click());
  assert.deepEqual(useFixture.pauses, [[usePoint]], 'using a source pauses without clearing the draft');
  assert.equal(useFixture.used[0], useFixture.choices[3]);
  assert.equal(useFixture.operationsCalls.save, 0);
});

test('mark falls back to the comparison camera center if the map center is unavailable', async t => {
  const f = await mount(t);
  f.setMapCenter(null);
  await f.act(async () => [...f.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '标记').click());
  assert.deepEqual(f.marked, [f.cameraValue.center]);
});

test('3D control enables terrain on both panes and changes the primary camera view', async t => {
  const f = await mount(t);
  await f.act(async () => f.host.querySelector('[aria-label="切换对比地图二维三维"]').click());
  assert.deepEqual(f.handleCalls.terrain, [
    ['map-comparison-primary', true],
    ['map-comparison-secondary', true],
  ]);
  assert.deepEqual(f.handleCalls.view, [['map-comparison-primary', 50, f.cameraValue.bearing, false]]);
});

test('line properties send color edits to the existing route-style callback', async t => {
  const f = await mount(t);
  await f.act(async () => f.host.querySelector('[aria-label="画线属性"]').click());
  const color = f.host.querySelector('[aria-label="对比路线颜色"]');
  await changeReactControl(f, color, '#00ff00');
  assert.equal(f.styleState.calls.length, 1);
  assert.deepEqual(f.styleState.calls[0], { color: '#00ff00', width: 3, opacity: 0.5 });
  assert.ok(f.host.querySelector('[aria-label="对比路线样式"]'));
});

test('marker editor keeps edits after save failure and closes after a successful retry', async t => {
  const f = await mount(t);
  await f.act(async () => counters.latest['map-comparison-primary'].onAnnotationSelect('saved-marker'));
  const name = f.host.querySelector('[aria-label="标记名称"]');
  await changeReactControl(f, name, '新名称');
  const note = f.host.querySelector('[aria-label="标记备注"]');
  await changeReactControl(f, note, '新备注');
  f.markerState.updateResult = false;
  await f.act(async () => f.host.querySelector('[aria-label="编辑对比标记"] form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(f.markerState.updateCalls.length, 1);
  assert.equal(f.markerState.updateCalls[0].id, 'saved-marker');
  assert.deepEqual(f.markerState.updateCalls[0].patch, { name: '新名称', note: '新备注', color: '#00aa00' });
  assert.ok(f.host.querySelector('[role="alert"]'));
  assert.ok(f.host.querySelector('[aria-label="编辑对比标记"]'), 'failed save leaves the editor open');
  assert.equal(f.host.querySelector('[aria-label="标记名称"]').value, '新名称');
  f.markerState.updateResult = true;
  await f.act(async () => f.host.querySelector('[aria-label="编辑对比标记"] form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(f.markerState.updateCalls.length, 2);
  assert.equal(f.host.querySelector('[aria-label="编辑对比标记"]'), null, 'successful save closes the editor');
});

test('cancelling marker edits does not call the saved-annotation update callback', async t => {
  const f = await mount(t);
  await f.act(async () => counters.latest['map-comparison-secondary'].onAnnotationSelect('saved-marker'));
  const name = f.host.querySelector('[aria-label="标记名称"]');
  await changeReactControl(f, name, '不保存');
  await f.act(async () => f.host.querySelector('[aria-label="标记符号"]').click());
  await f.act(async () => f.host.querySelector('[aria-label="营地"]').click());
  await f.act(async () => [...f.host.querySelectorAll('.comparison-marker-actions button')].find(button => button.textContent === '取消').click());
  assert.equal(f.markerState.updateCalls.length, 0);
  assert.equal(f.host.querySelector('[aria-label="编辑对比标记"]'), null);
});

test('marker symbol selection is saved with the existing marker fields', async t => {
  const f = await mount(t);
  await f.act(async () => counters.latest['map-comparison-secondary'].onAnnotationSelect('saved-marker'));
  const symbol = f.host.querySelector('[aria-label="标记符号"]');
  await f.act(async () => symbol.click());
  assert.equal(f.host.querySelectorAll('.comparison-symbol-grid button').length, 18);
  assert.equal(f.host.querySelector('[aria-label="地点"]').getAttribute('aria-pressed'), 'true');
  await f.act(async () => f.host.querySelector('[aria-label="营地"]').click());
  assert.equal(f.host.querySelector('.comparison-symbol-grid'), null);
  await f.act(async () => f.host.querySelector('[aria-label="编辑对比标记"] form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true })));
  assert.deepEqual(f.markerState.updateCalls[0].patch, { name: '已有标记', note: '旧备注', color: '#00aa00', icon: 'camp' });
  assert.equal(f.host.querySelector('[aria-label="编辑对比标记"]'), null);
});

test('returning from symbol page retains unsaved marker text and selected symbol', async t => {
  const f = await mount(t);
  await f.act(async () => counters.latest['map-comparison-primary'].onAnnotationSelect('saved-marker'));
  await changeReactControl(f, f.host.querySelector('[aria-label="标记名称"]'), '保留草稿');
  await f.act(async () => f.host.querySelector('[aria-label="标记符号"]').click());
  await f.act(async () => f.host.querySelector('[aria-label="营地"]').click());
  await f.act(async () => f.host.querySelector('[aria-label="标记符号"]').click());
  assert.equal(f.host.querySelector('[aria-label="营地"]').getAttribute('aria-pressed'), 'true');
  await f.act(async () => f.host.querySelector('[aria-label="返回标记编辑"]').click());
  assert.equal(f.host.querySelector('[aria-label="标记名称"]').value, '保留草稿');
  assert.equal(f.markerState.updateCalls.length, 0);
});
