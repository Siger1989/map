import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const counters = { mount: {}, unmount: {}, latest: {}, cameraCalls: {}, previews: {} };
let PositionButton;
const sources = {
  '../map/TerrainMap': `export type TerrainMapProps = any; export type MapHandle = any;`,
};

async function loadHost() {
  await build({
    stdin: { contents: "export { MapComparisonHost } from './modules/mapComparison/MapComparisonHost'; export { ComparisonEditorPositionButton } from './modules/mapComparison/ComparisonEditorPosition';", resolveDir: process.cwd(), loader: 'tsx' },
    outfile: '.openai/map-comparison-test/MapComparisonHost.js',
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
  const module = await import('../.openai/map-comparison-test/MapComparisonHost.js');
  PositionButton = module.ComparisonEditorPositionButton;
  return module.MapComparisonHost;
}

function setupDom() {
  const { window } = parseHTML('<html><body></body></html>');
  const storage = new Map();
  let failStorage = false;
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
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) { if (failStorage) throw new Error('storage unavailable'); storage.set(key, String(value)); },
      removeItem: key => storage.delete(key),
    },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  window.setStorageFailure = value => { failStorage = value; };
  window.storage = storage;
  return window;
}

async function chooseSource(f, pane, id) {
  const control = f.host.querySelector(`[aria-label="${pane}方图源"]`);
  await f.act(async () => control.click());
  await f.act(async () => f.host.querySelector(`[data-choice-id="${id}"]`).click());
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

function layerSettings(overrides = {}) {
  return {
    terrain: true,
    satellite: false,
    satelliteProvider: 'sentinel',
    offlineBasemap: false,
    tiandituBase: 'vec',
    tiandituLabels: 'auto',
    tiandituBoundaries: true,
    offlineMaxZoom: null,
    contours: false,
    contourInterval: 30,
    elevationColors: false,
    elevationColorsOpacity: 1,
    geology: false,
    geologySource: 'world',
    geologyOpacity: 0.85,
    roads: true,
    roadsOpacity: 1,
    rasterLevel: null,
    labels: true,
    exaggeration: 1,
    imageryMode: 'detail',
    ...overrides,
  };
}

function makeFixture(React) {
  for (const key of Object.keys(counters)) counters[key] = {};
  const sourceA = { id: 'source-a' };
  const sourceB = { id: 'source-b' };
  const settingsCurrent = layerSettings({ satellite: false, label: 'current' });
  const settingsA = layerSettings({ satellite: false, label: 'A' });
  const settingsB = layerSettings({ satellite: true, label: 'B' });
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
      previewTrackNode(preview) {
        counters.previews[identity] ??= [];
        counters.previews[identity].push(preview);
      },
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
  const operationsCalls = { draw: 0, undo: 0, save: 0, locate: 0, outline: 0, follow: 0 };
  const directionState = { mode: 'free', status: '设备朝向暂不可用', calls: [] };
  const followState = { active: false, tracking: false, locating: false, locationError: '', blocked: false };
  const operationState = { saveResult: true, error: '', selectedTrack: null, editingTrack: false, editSelectedTrackCalls: 0, deleteSelectedTrackCalls: 0, deleteResult: true };
  const drawingInputs = [];
  const snappingState = { nodes: true, roads: false, rivers: false, calls: [] };
  let mapCenter = [104.25, 30.75];
  const cameraValue = { center: [104, 30], zoom: 9, bearing: 12, pitch: 0 };
  const handleCalls = { terrain: [], view: [], viewGesture: [], zoom: [], north: 0 };
  const markerState = { current: null, selectCalls: [], updateCalls: [], updateResult: true };
  const styleState = {
    current: { color: '#ff0000', width: 3, opacity: 0.5 },
    calls: [],
  };
  const operations = {
    onMark(point, kind) {
      marked.push({ point, kind });
      markerState.current = { id: `new-${marked.length}`, name: '新标记', note: '', color: '#ff0000', coordinates: point };
      return true;
    },
    onOutline() { operationsCalls.outline += 1; },
    onDraw() { operationsCalls.draw += 1; },
    onVertex(point) { vertices.push(point); },
    onUndo() { operationsCalls.undo += 1; vertices.pop(); },
    onSave() { operationsCalls.save += 1; return operationState.saveResult; },
    onPause() { pauses.push([...vertices]); },
    onLocate() { operationsCalls.locate += 1; },
    get direction() { return directionState.mode; },
    get directionStatus() { return directionState.status; },
    onDirectionChange(mode) { directionState.mode = mode; directionState.calls.push(mode); },
    get following() { return followState.active; },
    get tracking() { return followState.tracking; },
    get locating() { return followState.locating; },
    get locationError() { return followState.locationError; },
    get followBlocked() { return followState.blocked; },
    onToggleFollowing() { operationsCalls.follow += 1; },
    canUndo: true,
    get snapping() { return snappingState.nodes; },
    onSnappingChange(enabled) { snappingState.nodes = enabled; snappingState.calls.push(['nodes', enabled]); },
    get roadSnapping() { return snappingState.roads; },
    onRoadSnappingChange(enabled) { snappingState.roads = enabled; if (enabled) snappingState.rivers = false; snappingState.calls.push(['roads', enabled]); },
    get riverSnapping() { return snappingState.rivers; },
    onRiverSnappingChange(enabled) { snappingState.rivers = enabled; if (enabled) snappingState.roads = false; snappingState.calls.push(['rivers', enabled]); },
    get error() { return operationState.error; },
    get selectedTrack() { return operationState.selectedTrack; },
    get editingTrack() { return operationState.editingTrack; },
    onEditSelectedTrack() { operationState.editSelectedTrackCalls += 1; },
    onDeleteSelectedTrack() {
      operationState.deleteSelectedTrackCalls += 1;
      if (operationState.deleteResult) operationState.selectedTrack = null;
      return operationState.deleteResult;
    },
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
  let props;
  const trackCallbacks = {
    onTrackSelect() {},
    onTrackLineSelect() {},
    onTrackNodeSelect() {},
    onRouteSelect() {
      plannedRouteCalls.selected += 1;
      props.plannedRoute = plannedRoute;
    },
  };
  const plannedRouteCalls = { selected: 0, edit: 0, show: 0, details: 0, close: 0 };
  const plannedRoute = {
    distance: 12500,
    duration: 3600,
    onEdit() { plannedRouteCalls.edit += 1; },
    onShow() { plannedRouteCalls.show += 1; },
    onDetails() { plannedRouteCalls.details += 1; },
    onClose() { plannedRouteCalls.close += 1; props.plannedRoute = null; },
  };
  const mapPickCalls = [];
  const child = React.createElement(MapProbe, { ...overlays, ...trackCallbacks, onMapPick: point => mapPickCalls.push(point), drawingActive: false, persistCamera: true, settings: settingsCurrent, ref: primary });
  props = {
    session,
    primary,
    onClose: () => closed.push(true),
    onUse: choice => used.push(choice),
    search: React.createElement('div', { 'data-place-search': true }),
    onDrawingInput(index, event) { drawingInputs.push([index, event]); },
    drawingOverlay(index) { return React.createElement('div', { 'data-comparison-overlay': index }); },
    markerEditor(onClose) {
      return React.createElement('section', { 'aria-label': '共享标记工作区' },
        React.createElement('button', { 'aria-label': '关闭共享标记工作区', onClick: onClose }, '关闭'),
      );
    },
    editorOverlay: null,
    plannedRoute: null,
    editorPaneOverlay(index) { return React.createElement('div', { 'aria-label': `双图框选层-${index}` }); },
    operations,
    children: child,
  };
  return {
    props, session, choices, overlays, trackCallbacks, mapPickCalls, used, closed, primary, marked, vertices, pauses,
    operationsCalls, operationState, drawingInputs, snappingState, directionState, followState, mapCenter, cameraValue, handleCalls, markerState, styleState, plannedRouteCalls,
    setMapCenter(value) { mapCenter = value; },
    setMapDrawingActive(value) { props.children = React.cloneElement(child, { drawingActive: value }); },
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

test('browse, marker workspace, layer menu, and paused drawing all return through comparison close', async t => {
  const browse = await mount(t);
  await browse.act(async () => browse.host.querySelector('[aria-label="退出双图源对比"]').click());
  assert.deepEqual(browse.closed, [true], 'ordinary comparison browsing closes through the host callback');
  await browse.render(null);
  assert.equal(counters.unmount['map-comparison-secondary'], 1);

  const marker = await mount(t);
  await marker.act(async () => counters.latest['map-comparison-primary'].onAnnotationSelect('saved-marker'));
  assert.ok(marker.host.querySelector('[aria-label="共享标记工作区"]'));
  await marker.act(async () => marker.host.querySelector('[aria-label="退出双图源对比"]').click());
  assert.deepEqual(marker.closed, [true], 'closing comparison can leave the saved selection to the page state');
  assert.equal(marker.markerState.current.id, 'saved-marker', 'the existing annotation remains intact');

  const layer = await mount(t);
  await layer.act(async () => layer.host.querySelector('[aria-label="对比图层"]').click());
  assert.ok(layer.host.querySelector('[aria-label="对比图层设置"]'));
  await layer.act(async () => layer.host.querySelector('[aria-label="关闭对比图层"]').click());
  assert.equal(layer.host.querySelector('[aria-label="对比图层设置"]'), null);
  await layer.act(async () => layer.host.querySelector('[aria-label="退出双图源对比"]').click());
  assert.deepEqual(layer.closed, [true], 'the layer menu does not trap the user in comparison');

  const drawing = await mount(t);
  const drawButton = [...drawing.host.querySelectorAll('.map-comparison-actions button')]
    .find(button => button.textContent.includes('画线'));
  await drawing.act(async () => drawButton.click());
  const pauseButton = [...drawing.host.querySelectorAll('.map-comparison-actions button')]
    .find(button => button.textContent.includes('暂停'));
  await drawing.act(async () => pauseButton.click());
  assert.equal(drawing.pauses.length, 1, 'pausing drawing preserves the normal finish callback');
  assert.equal([...drawing.host.querySelectorAll('.map-comparison-actions button')]
    .some(button => button.textContent.includes('暂停')), false);
  await drawing.act(async () => drawing.host.querySelector('[aria-label="退出双图源对比"]').click());
  assert.deepEqual(drawing.closed, [true], 'paused draft state does not prevent returning to the map');
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
  assert.equal(upper.pickingActive, false, 'browse mode leaves the normal track and route hit tests enabled');
  assert.equal(upper.annotationPicking, true, 'existing markers stay selectable in browse mode');
  for (const key of Object.keys(f.trackCallbacks)) {
    if (key === 'onRouteSelect') {
      assert.notEqual(upper[key], f.trackCallbacks[key], 'route selection is wrapped to clear comparison panes');
      assert.notEqual(lower[key], f.trackCallbacks[key]);
      continue;
    }
    assert.equal(upper[key], f.trackCallbacks[key], `${key} reuses the main map business callback`);
    assert.equal(lower[key], f.trackCallbacks[key], `${key} is available from both map panes`);
  }
  await f.act(async () => upper.onMapPick([103.5, 31.5]));
  assert.deepEqual(f.mapPickCalls, [[103.5, 31.5]], 'blank-map clicks retain the main map clear/picking behavior');
  assert.equal(upper.queryOnPick, false, 'comparison clicks do not trigger the regular elevation query');
  assert.equal(lower.persistCamera, false);
  const fromUpper = { center: [103, 31], zoom: 11, bearing: 30, pitch: 15 };
  await f.act(async () => upper.onCameraChange(fromUpper));
  assert.equal(counters.cameraCalls['map-comparison-secondary'].at(-1), fromUpper);
  const fromLower = { center: [105, 32], zoom: 8, bearing: 270, pitch: 0 };
  await f.act(async () => counters.latest['map-comparison-secondary'].onReady());
  await f.act(async () => counters.latest['map-comparison-secondary'].onCameraChange(fromLower));
  assert.equal(counters.cameraCalls['map-comparison-primary'].at(-1), fromLower);
  const preview = { node: { trackId: 'route', coordinate: [104, 30] }, coordinate: [104.001, 30] };
  await f.act(async () => upper.onTrackPreview(preview));
  assert.equal(counters.previews['map-comparison-secondary'].at(-1), preview);
  assert.equal(counters.previews['map-comparison-primary'], undefined, 'forwarding a preview does not echo it back');
  await f.act(async () => lower.onTrackPreview(null));
  assert.equal(counters.previews['map-comparison-primary'].at(-1), null, 'cancel/reset reaches the peer pane');
});

test('planned route selection from either pane clears comparison overlays and shows its card inside the UI', async t => {
  for (const pane of ['primary', 'secondary']) {
    for (const obstruction of ['layer', 'properties']) {
      const f = await mount(t);
      if (obstruction === 'layer') {
        await f.act(async () => f.host.querySelector('[aria-label="对比图层"]').click());
        assert.ok(f.host.querySelector('[aria-label="对比图层设置"]'));
      } else {
        await f.act(async () => f.host.querySelector('[aria-label="画线属性"]').click());
        assert.ok(f.host.querySelector('[aria-label="对比路线样式"]'));
      }

      await f.act(async () => counters.latest[`map-comparison-${pane}`].onRouteSelect());
      assert.equal(f.plannedRouteCalls.selected, 1, `${pane} pane calls the shared route selection`);
      await f.render(f.session);

      assert.equal(f.host.querySelector('[aria-label="对比图层设置"]'), null);
      assert.equal(f.host.querySelector('[aria-label="对比路线样式"]'), null);
      const card = f.host.querySelector('[aria-label="已选规划路线"]');
      const comparisonUi = f.host.querySelector('[aria-label="双图源对比"]');
      assert.ok(card, 'the planned route operation card is rendered');
      assert.ok(comparisonUi.contains(card), 'the card is inside the visible comparison UI');
      assert.equal(f.closed.length, 0, 'selecting the route does not exit comparison');
    }
  }
});

test('planned route card delegates actions, closes without exiting comparison, and hides during editing', async t => {
  const f = await mount(t);
  await f.act(async () => counters.latest['map-comparison-primary'].onRouteSelect());
  await f.render(f.session);

  const nav = f.host.querySelector('[aria-label="双图规划路线操作"]');
  await f.act(async () => nav.querySelector('button.route-solid').click());
  await f.act(async () => nav.querySelector('button:not(.route-solid)').click());
  await f.act(async () => nav.querySelectorAll('button:not(.route-solid)')[1].click());
  assert.deepEqual(f.plannedRouteCalls, { selected: 1, edit: 1, show: 1, details: 1, close: 0 });

  await f.act(async () => f.host.querySelector('[aria-label="关闭规划路线操作"]').click());
  await f.render(f.session);
  assert.equal(f.host.querySelector('[aria-label="已选规划路线"]'), null);
  assert.equal(f.host.querySelector('[data-map="map-comparison-secondary"]') !== null, true);
  assert.deepEqual(f.closed, [], 'closing the card only clears route selection');

  await f.act(async () => counters.latest['map-comparison-secondary'].onRouteSelect());
  f.operationState.editingTrack = true;
  f.props.editorOverlay = f.React.createElement('section', { 'aria-label': '规划路线编辑器' }, '编辑中');
  await f.render(f.session);
  assert.equal(f.host.querySelector('[aria-label="已选规划路线"]'), null, 'editing suppresses browse actions');
  assert.ok(f.host.querySelector('[aria-label="规划路线编辑器"]'), 'the editor is visible');
  assert.equal(f.closed.length, 0);
});

test('selecting a saved route exposes the comparison edit entry', async t => {
  const f = await mount(t);
  f.operationState.selectedTrack = { id: 'saved-route', name: '林间路线' };
  await f.render(f.session);
  const entry = f.host.querySelector('.map-comparison-track-selection button');
  assert.equal(entry?.textContent, '编辑');
  await f.act(async () => entry.click());
  assert.equal(f.operationState.editSelectedTrackCalls, 1, 'the visible entry invokes the shared route editor callback');
  f.operationState.editingTrack = true;
  f.props.editorOverlay = f.React.createElement('section', { 'aria-label': '路线编辑工具' }, '点选 / 框选加 / 保存并退出');
  await f.render(f.session);
  assert.equal(counters.latest['map-comparison-primary'].annotationPicking, false, 'markers do not intercept edit-mode node selection');
  assert.equal(counters.latest['map-comparison-secondary'].annotationPicking, false);
  assert.ok(f.host.querySelector('[aria-label="路线编辑工具"]'), 'the shared editor toolbar is mounted inside the comparison UI');
  assert.ok(f.host.querySelector('[aria-label="双图框选层-0"]'));
  assert.ok(f.host.querySelector('[aria-label="双图框选层-1"]'));
  await f.act(async () => counters.latest['map-comparison-secondary'].onMapPick([104, 30]));
  assert.deepEqual(f.mapPickCalls.at(-1), [104, 30], 'blank clicks in the lower pane retain branch placement');
});

test('route and marker editor position toggles keep fields, sub-pages, maps and camera intact', async t => {
  const f = await mount(t);
  const cameraCalls = JSON.stringify(counters.cameraCalls);
  const mounts = JSON.stringify(counters.mount);
  f.props.editorOverlay = f.React.createElement('section', { 'aria-label': '测试路线编辑工具' },
    f.React.createElement('header', null, '编辑路线', f.React.createElement(PositionButton, {kind: '路线'})),
    f.React.createElement('input', { defaultValue: '路线未保存草稿' }));
  await f.render(f.session);
  let route = f.host.querySelector('[aria-label="双图路线编辑窗口"]');
  assert.equal(route.dataset.pane, '1');
  const input = route.querySelector('input');
  input.value = '保留路线草稿';
  await f.act(async () => route.querySelector('button').click());
  assert.equal(route.dataset.pane, '0');
  assert.equal(route.querySelector('input'), input, 'moving uses the same editor DOM');
  assert.equal(input.value, '保留路线草稿');
  assert.equal(route.querySelector('.map-comparison-editor-position'), null, 'no added hint bar');
  assert.equal(route.querySelector('button').textContent, '', 'switch is icon-only in the original heading');
  assert.equal(route.querySelector('button').getAttribute('aria-label'), '路线编辑窗口移到下图');
  await f.act(async () => route.querySelector('button').click());
  assert.equal(route.dataset.pane, '1');
  f.props.editorOverlay = null;
  f.props.editorDialog = f.React.createElement('section', { role: 'dialog', 'aria-label': '测试未保存确认' }, '保留编辑');
  await f.render(f.session);
  assert.equal(f.host.querySelector('[role="dialog"]').closest('.map-comparison-edit-window'), null, 'unsaved confirmation stays outside the moving editor');
  f.props.editorDialog = null;
  f.props.markerEditor = () => f.React.createElement('section', null,
    f.React.createElement('header', null, '编辑标记', f.React.createElement(PositionButton, {kind: '标记'})),
    f.React.createElement('input', { 'aria-label': '测试标记名称', defaultValue: '标记草稿' }));
  await f.render(f.session);
  await f.act(async () => counters.latest['map-comparison-primary'].onAnnotationSelect('marker'));
  const marker = f.host.querySelector('[aria-label="双图标记编辑窗口"]');
  const markerInput = marker.querySelector('input');
  markerInput.value = '标记未保存名称';
  await f.act(async () => marker.querySelector('button').click());
  assert.equal(marker.dataset.pane, '0');
  assert.equal(marker.querySelector('input'), markerInput);
  assert.equal(markerInput.value, '标记未保存名称');
  await f.act(async () => f.window.setLandscape(true));
  assert.equal(marker.querySelector('button').getAttribute('aria-label'), '标记编辑窗口移到右图');
  await f.act(async () => marker.querySelector('button').click());
  assert.equal(marker.dataset.pane, '1');
  assert.equal(marker.querySelector('button').getAttribute('aria-label'), '标记编辑窗口移到左图');
  assert.equal(JSON.stringify(counters.cameraCalls), cameraCalls);
  assert.equal(JSON.stringify(counters.mount), mounts);
  assert.equal(f.closed.length, 0);
});

test('selected comparison route has an independent delete confirmation that preserves the two-map session', async t => {
  const f = await mount(t);
  f.operationState.selectedTrack = { id: 'saved-route', name: '林间路线' };
  await f.render(f.session);
  const upper = counters.latest['map-comparison-primary'];
  const camera = { center: [103.8483, 31.5621], zoom: 8.69, bearing: 35, pitch: 50 };
  await f.act(async () => upper.onCameraChange(camera));
  const secondaryCallsBeforeDelete = counters.cameraCalls['map-comparison-secondary'].length;

  await f.act(async () => f.host.querySelector('[aria-label="删除双图已选路线"]').click());
  assert.ok(f.host.querySelector('[aria-label="确认删除双图已选路线"]'), 'delete first opens a confirmation');
  assert.match(f.host.querySelector('[aria-label="确认删除双图已选路线"]').textContent, /关联照片、标记及来源路线保留/);
  await f.act(async () => f.host.querySelector('[aria-label="确认删除双图已选路线"] button').click());
  assert.equal(f.operationState.deleteSelectedTrackCalls, 0, 'cancel never calls the delete callback');
  assert.ok(f.host.querySelector('[aria-label="已选路线"]'), 'cancel keeps the selected route card');

  await f.act(async () => f.host.querySelector('[aria-label="删除双图已选路线"]').click());
  f.operationState.deleteResult = false;
  await f.act(async () => f.host.querySelector('[aria-label="确认删除双图已选路线"] button.route-danger').click());
  assert.equal(f.operationState.deleteSelectedTrackCalls, 1, 'confirmation calls the existing delete callback');
  assert.ok(f.host.querySelector('[aria-label="确认删除双图已选路线"]'), 'a failed persistence result keeps the confirmation open');
  assert.ok(f.host.querySelector('[aria-label="已选路线"]'), 'a failed delete keeps the selected route');
  f.operationState.deleteResult = true;
  await f.act(async () => f.host.querySelector('[aria-label="确认删除双图已选路线"] button.route-danger').click());
  assert.equal(f.operationState.deleteSelectedTrackCalls, 2, 'a failed delete can be retried through the same confirmation');
  assert.equal(f.host.querySelector('[aria-label="已选路线"]'), null, 'successful deletion removes the selected-route card');
  assert.equal(f.closed.length, 0, 'deleting a route does not close comparison');
  assert.equal(counters.unmount['map-comparison-secondary'] ?? 0, 0, 'both panes stay mounted after deletion');
  assert.deepEqual(counters.cameraCalls['map-comparison-secondary'].at(-1), camera, 'the secondary pane retains the live view');
  assert.equal(counters.cameraCalls['map-comparison-secondary'].length, secondaryCallsBeforeDelete, 'deletion does not reset or resynchronize camera');
});

test('a loading comparison pane cannot overwrite the primary zoom and adopts the latest view when ready', async t => {
  const f = await mount(t);
  const upper = counters.latest['map-comparison-primary'];
  const lower = counters.latest['map-comparison-secondary'];
  const live = { center: [103.8483, 31.5621], zoom: 8.69, bearing: 35, pitch: 50 };
  await f.act(async () => upper.onCameraChange(live));
  await f.act(async () => lower.onCameraChange({ ...f.session.camera, zoom: 15 }));
  assert.equal(counters.cameraCalls['map-comparison-primary']?.length ?? 0, 0);
  await f.act(async () => lower.onReady());
  assert.deepEqual(counters.cameraCalls['map-comparison-secondary'].at(-1), live);
  const gesture = { ...live, zoom: 9.2 };
  await f.act(async () => lower.onCameraChange(gesture));
  assert.deepEqual(counters.cameraCalls['map-comparison-primary'].at(-1), gesture);

  await f.render(null);
  await f.render({ ...f.session, camera: gesture });
  const before = counters.cameraCalls['map-comparison-primary'].length;
  await f.act(async () => counters.latest['map-comparison-secondary'].onCameraChange({ ...live, zoom: 3 }));
  assert.equal(counters.cameraCalls['map-comparison-primary'].length, before, 'reopening resets the loading guard');
  await f.act(async () => counters.latest['map-comparison-secondary'].onReady());
  assert.deepEqual(counters.cameraCalls['map-comparison-secondary'].at(-1), gesture);
});

test('source stepping changes only that pane, wraps, and does not use or persist a source', async t => {
  const f = await mount(t);
  const upperNext = f.host.querySelector('[aria-label="上图：下一图源"]');
  await f.act(async () => upperNext.click());
  assert.equal(counters.latest['map-comparison-primary'].mapSource, null, 'upper advances from current to sentinel');
  assert.deepEqual(counters.latest['map-comparison-primary'].settings, f.choices[1].settings);
  assert.equal(counters.latest['map-comparison-secondary'].settings, f.choices[1].settings, 'lower stays on sentinel');
  await chooseSource(f, '下', 'beta');
  assert.equal(counters.latest['map-comparison-secondary'].mapSource, f.choices[3].source);
  assert.deepEqual(counters.latest['map-comparison-primary'].settings, f.choices[1].settings, 'changing lower leaves upper unchanged');
  await f.act(async () => f.host.querySelector('[aria-label="下图：下一图源"]').click());
  assert.deepEqual(counters.latest['map-comparison-secondary'].settings, f.choices[0].settings, 'last choice wraps to first');
  assert.deepEqual(f.used, []);
});

test('comparison picker groups, shared favorites, collapsed-group persistence and common-only stepping stay in sync', async t => {
  const f = await mount(t);
  await f.act(async () => f.host.querySelector('[aria-label="上方图源"]').click());
  const alphaFavorite = f.host.querySelector('[aria-label="加入常用：alpha"]');
  await f.act(async () => alphaFavorite.click());
  await f.act(async () => f.host.querySelector('[aria-label="加入常用：beta"]').click());
  const commonHeader = [...f.host.querySelectorAll('.comparison-source-group-heading')].find(button => button.textContent.includes('常用'));
  assert.ok(commonHeader);
  assert.deepEqual([...f.host.querySelectorAll('.comparison-source-group-heading')].map(button => button.textContent.replace(/[+−]/g, '').trim()), ['常用', '当前', '内置', '我的图源', '公共库'], 'each named group has its own collapsible heading');
  assert.equal(f.host.querySelectorAll('[data-choice-id="alpha"]').length, 1, 'a favorited choice appears only in 常用');
  assert.equal(f.host.querySelector('[aria-label="移出常用：alpha"]').getAttribute('aria-pressed'), 'true');

  for (const name of ['当前', '内置', '我的图源', '公共库']) {
    const header = [...f.host.querySelectorAll('.comparison-source-group-heading')].find(button => button.textContent.includes(name));
    if (header?.getAttribute('aria-expanded') === 'true') await f.act(async () => header.click());
  }
  assert.deepEqual(JSON.parse(f.window.storage.get('shantu-map-comparison-source-groups-v1')), ['常用']);
  await f.act(async () => f.host.querySelector('[aria-label="下方图源"]').click());
  assert.equal([...f.host.querySelectorAll('[aria-label="下方图源选择"] .comparison-source-group-heading')]
    .find(button => button.textContent.includes('当前')).getAttribute('aria-expanded'), 'false', 'both panes read the same open-group preference');
  await f.act(async () => f.host.querySelector('[aria-label="上图：下一图源"]').click());
  assert.equal(counters.latest['map-comparison-primary'].mapSource, f.choices[2].source, 'a hidden current group is skipped; next selects the first visible favorite');
  await f.act(async () => f.host.querySelector('[aria-label="下图：下一图源"]').click());
  assert.equal(counters.latest['map-comparison-secondary'].mapSource, f.choices[2].source, 'an unavailable current lower choice also starts at the first common source');
  await f.act(async () => f.host.querySelector('[aria-label="上图：下一图源"]').click());
  assert.equal(counters.latest['map-comparison-primary'].mapSource, f.choices[3].source);
  await f.act(async () => f.host.querySelector('[aria-label="上图：下一图源"]').click());
  assert.equal(counters.latest['map-comparison-primary'].mapSource, f.choices[2].source, 'quick-step wraps within the common group');

  const upperPopup = f.host.querySelector('[aria-label="上方图源选择"]');
  while ([...upperPopup.querySelectorAll('.comparison-source-group-heading')].some(button => button.getAttribute('aria-expanded') === 'true')) {
    const heading = [...upperPopup.querySelectorAll('.comparison-source-group-heading')].find(button => button.getAttribute('aria-expanded') === 'true');
    await f.act(async () => heading.click());
  }
  assert.equal(f.host.querySelector('[aria-label="上图：上一图源"]').disabled, true, 'all collapsed groups disable source stepping');
  assert.equal(f.host.querySelector('[aria-label="上图：下一图源"]').disabled, true);
  await f.act(async () => f.host.querySelector('[aria-label="上方图源选择"] .comparison-source-group-heading').click());
  assert.equal(f.host.querySelector('[aria-label="上图：下一图源"]').disabled, false, 'the picker remains openable to restore an expanded group');
});

test('picker failed favorite writes are inert; keyboard, outside click, Escape, collapse and Use preserve map camera', async t => {
  const f = await mount(t);
  const cameraCalls = ['map-comparison-primary', 'map-comparison-secondary'].map(key => counters.cameraCalls[key]?.length ?? 0);
  const trigger = f.host.querySelector('[aria-label="上方图源"]');
  let focusReturned = false;
  trigger.focus = () => { focusReturned = true; };
  await f.act(async () => trigger.click());
  f.window.setStorageFailure(true);
  await f.act(async () => f.host.querySelector('[aria-label="加入常用：alpha"]').click());
  assert.equal(f.host.querySelector('[aria-label="加入常用：alpha"]').getAttribute('aria-pressed'), 'false', 'failed persistence does not show a favorite that was not saved');
  f.window.setStorageFailure(false);

  const picker = f.host.querySelector('[aria-label="上方图源选择"]');
  const currentHeader = [...picker.querySelectorAll('.comparison-source-group-heading')].find(button => button.textContent.includes('当前'));
  await f.act(async () => currentHeader.click());
  assert.equal(currentHeader.getAttribute('aria-expanded'), 'false');
  assert.equal(counters.latest['map-comparison-primary'].mapSource, f.choices[0].source, 'collapsing the selected group does not change its map source');
  const firstEscape = new f.window.Event('keydown', { bubbles: true });
  Object.defineProperty(firstEscape, 'key', { value: 'Escape' });
  await f.act(async () => f.host.querySelector('[aria-label="上方图源选择"]').dispatchEvent(firstEscape));
  assert.equal(f.host.querySelector('[aria-label="上方图源选择"]'), null, 'Escape closes the popup without exiting comparison');
  const arrowDown = new f.window.Event('keydown', { bubbles: true });
  Object.defineProperty(arrowDown, 'key', { value: 'ArrowDown' });
  await f.act(async () => f.host.querySelector('[aria-label="上方图源"]').dispatchEvent(arrowDown));
  assert.equal(f.host.querySelector('[aria-label="上方图源"]').getAttribute('aria-expanded'), 'true', 'arrow-down opens the picker');
  const escape = new f.window.Event('keydown', { bubbles: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  await f.act(async () => f.host.querySelector('[aria-label="上方图源选择"]').dispatchEvent(escape));
  assert.equal(f.host.querySelector('[aria-label="上方图源选择"]'), null, 'Escape closes the popup without exiting comparison');
  assert.equal(focusReturned, true, 'Escape restores trigger focus');
  assert.equal(f.closed.length, 0);

  focusReturned = false;
  await f.act(async () => f.host.querySelector('[aria-label="上方图源"]').click());
  const outside = f.host.querySelector('[aria-label="地图朝向模式"]');
  await f.act(async () => outside.dispatchEvent(new f.window.Event('pointerdown', { bubbles: true })));
  assert.equal(f.host.querySelector('[aria-label="上方图源选择"]'), null, 'outside click closes the popup');
  assert.equal(focusReturned, true, 'outside click restores selector focus');
  assert.deepEqual(['map-comparison-primary', 'map-comparison-secondary'].map(key => counters.cameraCalls[key]?.length ?? 0), cameraCalls, 'picker interactions never apply a camera or change zoom');
});

test('Use applies the exact upper or lower choice only when its button is pressed', async t => {
  const f = await mount(t);
  await f.act(async () => f.host.querySelector('[aria-label="使用上方图源"]').click());
  assert.equal(f.used.at(-1).id, f.choices[0].id);
  assert.equal(f.used.at(-1).source, f.choices[0].source);
  assert.equal(f.used.length, 1);
  await chooseSource(f, '下', 'beta');
  await f.act(async () => f.host.querySelector('[aria-label="使用下方图源"]').click());
  assert.equal(f.used.at(-1).id, f.choices[3].id);
  assert.equal(f.used.at(-1).source, f.choices[3].source);
  assert.equal(f.used.length, 2);
});

test('comparison layer menu exposes per-pane complete switches with custom-source satellite rules', async t => {
  const f = await mount(t);
  const beforeCameraCalls = Object.fromEntries(Object.entries(counters.cameraCalls).map(([key, calls]) => [key, calls.length]));
  await f.act(async () => f.host.querySelector('[aria-label="对比图层"]').click());
  let switches = [...f.host.querySelectorAll('#comparison-layer-window [role="switch"]')];
  assert.equal(switches.length, 6, 'the upper custom source hides only the inapplicable satellite toggle');
  assert.equal(f.host.querySelector('#satellite-toggle'), null);
  for (const key of ['terrain', 'elevationColors', 'contours', 'geology', 'roads', 'labels'])
    assert.ok(f.host.querySelector(`#${key}-toggle`), `upper pane has ${key} toggle`);

  await f.act(async () => f.host.querySelector('.comparison-layer-tabs button:nth-child(2)').click());
  switches = [...f.host.querySelectorAll('#comparison-layer-window [role="switch"]')];
  assert.equal(switches.length, 7, 'the lower built-in choice exposes all standard layer switches');
  assert.ok(f.host.querySelector('#satellite-toggle'));
  assert.equal(counters.latest['map-comparison-primary'].settings, f.choices[0].settings);
  assert.equal(counters.latest['map-comparison-secondary'].settings, f.choices[1].settings);
  for (const [key, count] of Object.entries(beforeCameraCalls))
    assert.equal(counters.cameraCalls[key].length, count, `opening and switching layer tabs leaves ${key} camera unchanged`);
});

test('comparison layer switches keep upper and lower settings independent and preserve thematic exclusivity', async t => {
  const f = await mount(t);
  await f.act(async () => f.host.querySelector('[aria-label="对比图层"]').click());

  await f.act(async () => f.host.querySelector('#geology-toggle').click());
  let upper = counters.latest['map-comparison-primary'].settings;
  assert.equal(upper.geology, true);
  assert.equal(upper.elevationColors, false);
  assert.equal(counters.latest['map-comparison-secondary'].settings.geology, false, 'upper edit does not change lower settings');

  await f.act(async () => f.host.querySelector('#elevationColors-toggle').click());
  upper = counters.latest['map-comparison-primary'].settings;
  assert.equal(upper.elevationColors, true);
  assert.equal(upper.geology, false);

  await f.act(async () => f.host.querySelector('.comparison-layer-tabs button:nth-child(2)').click());
  await f.act(async () => f.host.querySelector('#geology-toggle').click());
  const lower = counters.latest['map-comparison-secondary'].settings;
  assert.equal(lower.geology, true);
  assert.equal(lower.elevationColors, false);
  upper = counters.latest['map-comparison-primary'].settings;
  assert.equal(upper.elevationColors, true, 'lower edit leaves upper thematic choice intact');
});

test('roads and display parameters update only the active comparison pane', async t => {
  const f = await mount(t);
  const cameraCallsAtStart = ['map-comparison-primary', 'map-comparison-secondary'].map(key => counters.cameraCalls[key]?.length ?? 0);
  await f.act(async () => f.host.querySelector('[aria-label="对比图层"]').click());
  await f.act(async () => f.host.querySelector('#roads-toggle').click());
  let upper = counters.latest['map-comparison-primary'].settings;
  assert.equal(upper.roads, false);

  const parameters = f.host.querySelector('details.layer-display-settings');
  assert.ok(parameters);
  assert.equal(parameters.hasAttribute('open'), false, 'display parameters start collapsed');
  const roadsOpacity = f.host.querySelector('#roads-opacity');
  assert.ok(roadsOpacity);
  await changeReactControl(f, roadsOpacity, '0.4');
  upper = counters.latest['map-comparison-primary'].settings;
  assert.equal(upper.roadsOpacity, 0.4);
  assert.equal(counters.latest['map-comparison-secondary'].settings.roadsOpacity, f.choices[1].settings.roadsOpacity);

  await f.act(async () => f.host.querySelector('.comparison-layer-tabs button:nth-child(2)').click());
  await f.act(async () => f.host.querySelector('#roads-toggle').click());
  assert.equal(counters.latest['map-comparison-primary'].settings.roads, false, 'changing lower roads keeps upper roads choice');
  assert.equal(counters.latest['map-comparison-secondary'].settings.roads, false);
  assert.deepEqual(['map-comparison-primary', 'map-comparison-secondary'].map(key => counters.cameraCalls[key]?.length ?? 0), cameraCallsAtStart, 'layer toggles do not apply a new camera');
});

test('layer settings persist across source changes, and Use returns only the selected pane settings', async t => {
  const f = await mount(t);
  const cameraCallsAtStart = ['map-comparison-primary', 'map-comparison-secondary'].map(key => counters.cameraCalls[key]?.length ?? 0);
  await f.act(async () => f.host.querySelector('[aria-label="对比图层"]').click());
  await f.act(async () => f.host.querySelector('#roads-toggle').click());
  await changeReactControl(f, f.host.querySelector('#roads-opacity'), '0.45');
  await f.act(async () => f.host.querySelector('[aria-label="关闭对比图层"]').click());
  await f.act(async () => f.host.querySelector('[aria-label="对比图层"]').click());
  assert.equal(counters.latest['map-comparison-primary'].settings.roads, false);
  await changeReactControl(f, f.host.querySelector('#roads-opacity'), '0.45');
  assert.equal(counters.latest['map-comparison-primary'].settings.roadsOpacity, 0.45);

  await chooseSource(f, '上', 'beta');
  await f.act(async () => f.host.querySelector('#roads-toggle').click());
  await changeReactControl(f, f.host.querySelector('#roads-opacity'), '0.35');
  await chooseSource(f, '上', 'sentinel');
  await chooseSource(f, '上', 'beta');
  assert.equal(counters.latest['map-comparison-primary'].settings.roads, true, 'new basemap selection carries the pane current road toggle');
  assert.equal(counters.latest['map-comparison-primary'].settings.roadsOpacity, 0.35);

  await f.act(async () => f.host.querySelector('.comparison-layer-tabs button:nth-child(2)').click());
  await f.act(async () => f.host.querySelector('#geology-toggle').click());
  await f.act(async () => f.host.querySelector('.comparison-layer-tabs button:nth-child(1)').click());
  assert.equal(counters.latest['map-comparison-secondary'].settings.geology, true);
  assert.equal(counters.latest['map-comparison-primary'].settings.geology, false);

  const lowerBefore = counters.latest['map-comparison-secondary'].settings;
  await f.act(async () => f.host.querySelector('[aria-label="使用上方图源"]').click());
  const used = f.used.at(-1);
  assert.equal(used.id, 'beta');
  assert.equal(used.source, f.choices[3].source);
  assert.equal(used.settings.roads, true);
  assert.equal(used.settings.roadsOpacity, 0.35);
  assert.equal(used.settings.geology, false, 'lower geology setting is not included in upper Use');
  assert.equal(used.settings.elevationColors, false);
  assert.equal(lowerBefore.roads, f.choices[1].settings.roads, 'upper choice edits do not leak to the lower pane');
  assert.deepEqual(['map-comparison-primary', 'map-comparison-secondary'].map(key => counters.cameraCalls[key]?.length ?? 0), cameraCallsAtStart, 'layer changes and Use do not apply a new camera');
});

test('source changes keep pane overlays while restoring only the target source base settings', async t => {
  const f = await mount(t);
  f.choices[0].settings = layerSettings({
    contours: true,
    contourInterval: 50,
    elevationColors: true,
    elevationColorsOpacity: 0.35,
    roads: false,
    roadsOpacity: 0.4,
    geology: false,
    geologyOpacity: 0.6,
    terrain: false,
    exaggeration: 1.7,
    labels: false,
    tiandituLabels: 'cia',
    tiandituBoundaries: false,
  });
  f.choices[3].settings = layerSettings({
    satellite: true,
    satelliteProvider: 'tianditu',
    tiandituBase: 'img',
    imageryMode: 'latest',
    rasterLevel: 12,
    rasterDatums: { 'source-b': 'GCJ02' },
  });

  await f.act(async () => f.host.querySelector('[aria-label="对比图层"]').click());
  assert.equal(f.host.querySelector('#contours-toggle').getAttribute('aria-checked'), 'true');
  await f.act(async () => f.host.querySelector('#contours-toggle').click());
  const lowerBefore = counters.latest['map-comparison-secondary'].settings;
  assert.equal(counters.latest['map-comparison-primary'].settings.contours, false);

  await chooseSource(f, '上', 'beta');
  let upper = counters.latest['map-comparison-primary'].settings;
  assert.equal(upper.contours, false);
  assert.equal(upper.contourInterval, 50);
  assert.equal(upper.elevationColors, true);
  assert.equal(upper.elevationColorsOpacity, 0.35);
  assert.equal(upper.terrain, false, 'basemap selection keeps the pane 3D toggle');
  assert.equal(upper.exaggeration, 1.7, 'basemap selection keeps terrain exaggeration');
  assert.equal(upper.roads, false);
  assert.equal(upper.roadsOpacity, 0.4);
  assert.equal(upper.labels, false);
  assert.equal(upper.tiandituLabels, 'cia', 'annotation choice remains a pane layer preference');
  assert.equal(upper.tiandituBoundaries, false, 'boundary overlay toggle remains pane-local');
  assert.equal(upper.satellite, true);
  assert.equal(upper.satelliteProvider, 'tianditu');
  assert.equal(upper.tiandituBase, 'img');
  assert.equal(upper.imageryMode, 'latest');
  assert.equal(upper.rasterLevel, 12);
  assert.deepEqual(upper.rasterDatums, { 'source-b': 'GCJ02' });
  assert.equal(counters.latest['map-comparison-secondary'].settings, lowerBefore, 'switching the upper pane leaves lower pane settings untouched');

  await chooseSource(f, '上', 'sentinel');
  await chooseSource(f, '上', 'alpha');
  upper = counters.latest['map-comparison-primary'].settings;
  assert.equal(upper.contours, false, 'returning to a previous source keeps the pane current overlay state');
  assert.equal(upper.roads, false);
  await chooseSource(f, '上', 'beta');
  upper = counters.latest['map-comparison-primary'].settings;
  assert.equal(upper.contours, false, 'round trips do not restore a source snapshot');
  assert.equal(upper.satelliteProvider, 'tianditu', 'target source provider remains source-specific');
  assert.deepEqual(upper.rasterDatums, { 'source-b': 'GCJ02' }, 'target source datum remains source-specific');
  assert.equal(counters.latest['map-comparison-secondary'].settings, lowerBefore);
});

test('comparison marker entry directly creates a pin at the primary center and opens the shared workspace slot', async t => {
  const f = await mount(t);
  await f.act(async () => f.host.querySelector('[aria-label="添加地点标记"]').click());
  assert.deepEqual(f.marked, [{ point: f.mapCenter, kind: 'pin' }], 'the entry creates a pin directly at the live primary center');
  assert.equal(f.host.querySelector('[aria-label="选择添加类型"]'), null);
  assert.ok(f.host.querySelector('[aria-label="共享标记工作区"]'));
  assert.equal(f.host.querySelector('[aria-label="上图中心十字"]')?.getAttribute('role'), 'img');
  assert.equal(f.host.querySelector('[aria-label="下图中心十字"]')?.getAttribute('role'), 'img');
});

test('comparison reuses direction modes and reports actual direction status', async t => {
  const f = await mount(t);
  assert.equal(f.host.querySelector('.map-comparison-direction-status').textContent, '设备朝向暂不可用');
  await f.act(async () => f.host.querySelector('[aria-label="地图朝向模式"]').click());
  assert.ok(f.host.querySelector('[aria-label="选择地图朝向"]'));
  await f.act(async () => [...f.host.querySelectorAll('[aria-label="选择地图朝向"] button')].find(button => button.textContent === '运动方向朝上').click());
  assert.deepEqual(f.directionState.calls, ['motion']);
  await f.render(f.session);
  assert.equal(f.host.querySelector('[aria-label="地图朝向模式"]').getAttribute('aria-pressed'), 'true');
});

test('comparison follow action reflects and toggles the supplied follow state', async t => {
  const f = await mount(t);
  const button = f.host.querySelector('[aria-label="开启位置跟随"]');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  await f.act(async () => {
    button.click();
    await new Promise(resolve => f.window.setTimeout(resolve, 300));
  });
  f.followState.active = true;
  f.followState.tracking = true;
  await f.render(f.session);
  assert.equal(f.operationsCalls.follow, 1);
  assert.equal(f.host.querySelector('[aria-label="关闭位置跟随"]').getAttribute('aria-pressed'), 'true');
});

test('comparison follow feedback distinguishes waiting, effective tracking, retryable errors, and pause', async t => {
  const f = await mount(t);
  let button = f.host.querySelector('[aria-label="开启位置跟随"]');
  await f.act(async () => {
    button.click();
    await new Promise(resolve => f.window.setTimeout(resolve, 300));
  });
  f.followState.active = true;
  f.followState.locating = true;
  await f.render(f.session);
  button = f.host.querySelector('[aria-label="重试定位"]');
  assert.equal(button.getAttribute('aria-pressed'), 'false', 'requested follow is not reported as active tracking while waiting');
  assert.equal(button.querySelector('small').textContent, '定位中');
  assert.match(f.host.querySelector('.map-comparison-live').textContent, /正在获取/);

  f.followState.locating = false;
  await f.render(f.session);
  button = f.host.querySelector('[aria-label="重试定位"]');
  assert.ok(button, 'requested follow without an effective fix remains retryable');

  f.followState.tracking = true;
  await f.render(f.session);
  button = f.host.querySelector('[aria-label="关闭位置跟随"]');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(button.querySelector('small').textContent, '跟随中');

  f.followState.tracking = false;
  f.followState.locationError = '定位超时，请重试。';
  await f.render(f.session);
  button = f.host.querySelector('[aria-label="重试定位"]');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.querySelector('small').textContent, '重试');
  assert.equal(f.host.querySelector('.map-comparison-live').textContent, '定位超时，请重试。');
  await f.act(async () => {
    button.click();
    await new Promise(resolve => f.window.setTimeout(resolve, 300));
  });
  f.followState.active = true;
  f.followState.locating = true;
  f.followState.locationError = '';
  await f.render(f.session);
  assert.equal(f.followState.active, true, 'retry keeps requested following on');
  assert.equal(f.followState.locating, true);
  assert.equal(f.followState.locationError, '');

  f.followState.locating = false;
  f.followState.tracking = true;
  await f.render(f.session);
  button = f.host.querySelector('[aria-label="关闭位置跟随"]');
  await f.act(async () => {
    button.click();
    await new Promise(resolve => f.window.setTimeout(resolve, 300));
  });
  f.followState.active = false;
  f.followState.tracking = false;
  await f.render(f.session);
  button = f.host.querySelector('[aria-label="开启位置跟随"]');
  assert.equal(f.followState.active, false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.querySelector('small').textContent, '跟随');
});

test('deleting the selected marker removes the editor host and another marker can reopen it', async t => {
  const f = await mount(t);
  await f.act(async () => counters.latest['map-comparison-primary'].onAnnotationSelect('removed-marker'));
  assert.ok(f.host.querySelector('.map-comparison-editor-slot'));
  const renderWorkspace = f.props.markerEditor;
  f.props.markerEditor = () => null;
  await f.render(f.session);
  assert.equal(f.host.querySelector('.map-comparison-editor-slot'), null);
  f.props.markerEditor = renderWorkspace;
  await f.act(async () => counters.latest['map-comparison-secondary'].onAnnotationSelect('next-marker'));
  await f.render(f.session);
  assert.ok(f.host.querySelector('[aria-label="共享标记工作区"]'));
});

test('double clicking the shared locate/follow action locates without toggling follow', async t => {
  const f = await mount(t);
  const button = f.host.querySelector('[aria-label="开启位置跟随"]');
  await f.act(async () => {
    const first = new f.window.Event('click', { bubbles: true });
    Object.defineProperty(first, 'detail', { value: 1 });
    const second = new f.window.Event('click', { bubbles: true });
    Object.defineProperty(second, 'detail', { value: 2 });
    button.dispatchEvent(first);
    button.dispatchEvent(second);
  });
  assert.equal(f.operationsCalls.locate, 1);
  assert.equal(f.operationsCalls.follow, 0);
});

test('selecting an existing marker from either map opens its shared editor slot', async t => {
  const f = await mount(t);
  await f.act(async () => counters.latest['map-comparison-primary'].onAnnotationSelect('saved-1'));
  assert.deepEqual(f.markerState.selectCalls, ['saved-1']);
  assert.ok(f.host.querySelector('[aria-label="共享标记工作区"]'));
  await f.act(async () => f.host.querySelector('[aria-label="关闭共享标记工作区"]').click());
  assert.equal(f.host.querySelector('[aria-label="共享标记工作区"]'), null);
  assert.equal(f.closed.length, 0, 'closing the marker workspace does not exit comparison');
  await f.act(async () => counters.latest['map-comparison-secondary'].onAnnotationSelect('saved-2'));
  assert.deepEqual(f.markerState.selectCalls, ['saved-1', 'saved-2']);
  assert.ok(f.host.querySelector('[aria-label="共享标记工作区"]'));
});

test('draw mode uses both standard gesture bridges and the existing snap settings', async t => {
  const f = await mount(t);
  await f.act(async () => [...f.host.querySelectorAll('.map-comparison-actions button')].find(button => button.textContent === '画线').click());
  assert.equal(f.operationsCalls.draw, 1);
  assert.equal(counters.latest['map-comparison-primary'].drawingActive, true, 'primary map uses the normal drawing gesture bridge');
  assert.equal(counters.latest['map-comparison-secondary'].drawingActive, true, 'secondary map uses the normal drawing gesture bridge');
  assert.equal(counters.latest['map-comparison-secondary'].pickingActive, false, 'drawing input is not reduced to map clicks');
  assert.equal(f.host.querySelectorAll('[data-comparison-overlay]').length, 2, 'each map gets a viewport-local drawing overlay');
  assert.ok(f.host.querySelector('[data-place-search]'), 'the comparison header keeps a real search element');
  const nodeSnap = f.host.querySelector('[aria-label="节点吸附"]');
  const roadSnap = f.host.querySelector('[aria-label="道路吸附"]');
  const riverSnap = f.host.querySelector('[aria-label="河流吸附"]');
  assert.equal(nodeSnap.getAttribute('aria-pressed'), 'true');
  assert.equal(roadSnap.getAttribute('aria-pressed'), 'false');
  assert.equal(riverSnap.getAttribute('aria-pressed'), 'false');
  assert.equal(f.host.querySelector('[aria-label="自由手绘"]'), null, 'comparison stays in the normal extension-stick points mode');
  await f.act(async () => nodeSnap.click());
  assert.deepEqual(f.snappingState.calls, [['nodes', false]]);
  await f.render(f.session);
  await f.act(async () => f.host.querySelector('[aria-label="道路吸附"]').click());
  await f.render(f.session);
  assert.equal(f.host.querySelector('[aria-label="道路吸附"]').getAttribute('aria-pressed'), 'true');
  await f.act(async () => f.host.querySelector('[aria-label="河流吸附"]').click());
  await f.render(f.session);
  assert.equal(f.host.querySelector('[aria-label="道路吸附"]').getAttribute('aria-pressed'), 'false', 'river setting preserves the ordinary mutual-exclusion rule');
  assert.equal(f.host.querySelector('[aria-label="河流吸附"]').getAttribute('aria-pressed'), 'true');
  const first = { type: 'start', point: { x: 10, y: 20 } }, second = { type: 'move', point: { x: 30, y: 40 } };
  await f.act(async () => counters.latest['map-comparison-primary'].onDrawingInput(first));
  await f.act(async () => counters.latest['map-comparison-secondary'].onDrawingInput(second));
  assert.deepEqual(f.drawingInputs, [[0, first], [1, second]], 'input reaches the matching pane drawing session');
  f.vertices.push([104.1, 30.5], [104.2, 30.6]); // the pane-local TrackDrawing sessions share the regular route draft
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

test('branch editing keeps the main map drawing bridge and pane-local overlay active in browse mode', async t => {
  const f = await mount(t);
  f.operationState.editingTrack = true;
  f.setMapDrawingActive(true);
  await f.render(f.session);
  assert.equal(counters.latest['map-comparison-primary'].drawingActive, true, 'branch editing carries the main map drawing request to the upper pane');
  assert.equal(counters.latest['map-comparison-secondary'].drawingActive, true, 'branch editing carries the main map drawing request to the lower pane');
  assert.equal(f.host.querySelectorAll('[data-comparison-overlay]').length, 2, 'both branch tips get a map-local TrackDrawing host while comparison remains in browse mode');
  assert.equal(f.host.querySelector('.map-comparison-drawing-mode'), null, 'branch editing does not enable the ordinary new-track controls');
  assert.equal(f.host.querySelector('.map-comparison-track-selection'), null, 'the selected-route action does not cover the edit toolbar');
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
  await chooseSource(useFixture, '下', 'beta');
  await useFixture.act(async () => useFixture.host.querySelector('[aria-label="使用下方图源"]').click());
  assert.deepEqual(useFixture.pauses, [[usePoint]], 'using a source pauses without clearing the draft');
  assert.equal(useFixture.used[0].id, useFixture.choices[3].id);
  assert.equal(useFixture.used[0].source, useFixture.choices[3].source);
  assert.equal(useFixture.operationsCalls.save, 0);
});

test('mark falls back to the comparison camera center if the map center is unavailable', async t => {
  const f = await mount(t);
  f.setMapCenter(null);
  await f.act(async () => f.host.querySelector('[aria-label="添加地点标记"]').click());
  assert.deepEqual(f.marked, [{ point: f.cameraValue.center, kind: 'pin' }]);
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
