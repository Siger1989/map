import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { parseHTML } from 'linkedom';

test('navigation card and route summary expose first-person camera and route preview interactions', async (t) => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const output = '.openai/forward-navigation-ui-test';
  await mkdir(output, { recursive: true });
  await build({
    entryPoints: {
      GuidanceCard: 'modules/guidance/GuidanceCard.tsx',
      RouteResultSummary: 'modules/navigation/RouteResultSummary.tsx',
    },
    outdir: output,
    entryNames: '[name]',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'forward-navigation-component-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /RouteProviderNote/ }, () => ({ path: 'provider-note', namespace: 'fixture' }));
        builder.onResolve({ filter: /RouteElevationSummary/ }, () => ({ path: 'elevation-summary', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          contents: args.path === 'provider-note'
            ? `export function RouteProviderNote() { return null; }`
            : `export function RouteElevationSummary() { return null; }`,
        }));
      },
    }],
  });

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { GuidanceCard } = await import('../.openai/forward-navigation-ui-test/GuidanceCard.js');
  const { RouteResultSummary } = await import('../.openai/forward-navigation-ui-test/RouteResultSummary.js');
  const host = document.getElementById('root');
  const root = createRoot(host);
  const route = {
    coordinates: [[104, 30], [104.001, 30.001]],
    distance: 1000,
    duration: 300,
    mode: 'pedestrian',
    steps: [{ instruction: '沿路线前进', distance: 1000 }],
    createdAt: 1,
  };
  const session = {
    route,
    originalRoute: route,
    departurePending: false,
    departureLength: 0,
    departureRoute: null,
    path: { points: route.coordinates, cumulative: [0, 147], length: 147 },
    checkpoints: [],
    nextCheckpoint: 0,
    startedAt: 1,
    travelled: 0,
    progress: 0,
    offset: 0,
    last: null,
    anchor: null,
    quality: '',
    gap: false,
    offRoute: false,
    offSince: null,
    arriveSince: null,
    arrived: false,
  };
  const guidance = {
    session,
    instruction: { distance: 500, text: '沿路线前进' },
    remaining: 1000,
    error: '',
    loading: false,
    online: true,
    replan() {},
    retry() {},
    rejoining: false,
    replaning: false,
  };
  const firstPersonCalls = [];
  const cameraModeCalls = [];
  let cameraMode = 'forward';
  const cardProps = () => ({
    guidance,
    onStop() {},
    onFollow() {},
    onShow() {},
    following: false,
    onShare() {},
    compact: true,
    onFirstPerson() { firstPersonCalls.push('first-person'); },
    cameraMode,
    onCameraModeChange(mode) { cameraModeCalls.push(mode); },
  });

  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const key of ['window', 'document', 'HTMLElement', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  });

  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.ok(host.querySelector('[aria-label="第一人称模式"]'), 'the navigation header exposes first-person mode');
  assert.equal(host.querySelector('.guidance-first-person').getAttribute('aria-pressed'), 'true');
  assert.equal(host.querySelector('.guidance-first-person span').textContent, '近景');
  assert.equal(host.querySelector('[aria-label*="路书"]'), null, 'the original roadbook entry is absent');
  assert.doesNotMatch(host.textContent, /路书/);
  await React.act(async () => host.querySelector('[aria-label="第一人称模式"]').click());
  assert.deepEqual(firstPersonCalls, ['first-person'], 'the header action calls the first-person callback');
  await React.act(async () => root.render(React.createElement(GuidanceCard, {
    ...cardProps(), viewNotice: '第一人称路线预览 · 非定位导航，等待准确定位',
  })));
  assert.match(host.querySelector('header').textContent, /非定位导航，等待准确定位/, 'waiting for GPS still gives visible preview feedback');

  await React.act(async () => host.querySelector('[aria-label="展开导航详情"]').click());
  let cameraButton = [...host.querySelectorAll('.guidance-camera-mode')][0];
  assert.equal(cameraButton.textContent, '切换俯视');
  await React.act(async () => cameraButton.click());
  assert.deepEqual(cameraModeCalls, ['top']);
  cameraMode = 'top';
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('.guidance-first-person').getAttribute('aria-pressed'), 'false');
  assert.equal(host.querySelector('.guidance-first-person span').textContent, '俯视');
  cameraButton = host.querySelector('.guidance-camera-mode');
  assert.equal(cameraButton.textContent, '切换前视');
  await React.act(async () => cameraButton.click());
  assert.deepEqual(cameraModeCalls, ['top', 'forward']);

  const previewEvents = [];
  const summaryProps = (previewMode = null) => ({
    route,
    start: { name: '路线起点' },
    end: { name: '路线终点' },
    mode: 'pedestrian',
    loading: false,
    planningError: '',
    onModeChange() {},
    onSwap() {},
    onShow() {},
    onEdit() {},
    onSave() {},
    onShare() {},
    onStartNavigation() { previewEvents.push('start'); },
    navigating: false,
    guidanceError: '',
    saveMessage: '',
    previewMode,
    onPreview() { previewEvents.push('preview'); },
    onPreviewTopDown() { previewEvents.push('toggle'); },
    onExitPreview() { previewEvents.push('exit'); },
  });

  await React.act(async () => root.render(React.createElement(RouteResultSummary, summaryProps(null))));
  assert.equal(host.querySelector('.route-preview-actions button').textContent, '第一人称预览');
  await React.act(async () => host.querySelector('[aria-expanded="false"]').click());
  assert.ok(host.querySelector('.route-summary-detail'), 'route details can be opened before preview');
  await React.act(async () => host.querySelector('.route-preview-actions button').click());
  assert.deepEqual(previewEvents, ['preview'], 'starting preview calls onPreview');

  await React.act(async () => root.render(React.createElement(RouteResultSummary, summaryProps('forward'))));
  assert.match(host.querySelector('[role="status"]').textContent, /路线预览（第一人称）· 非定位导航/);
  assert.ok(host.querySelector('[role="status"]').textContent.includes('非定位导航'), 'preview clearly stays outside location navigation');
  assert.equal(host.querySelector('.route-summary-endpoints'), null, 'preview unmounts route endpoints');
  assert.equal(host.querySelector('.route-summary-metrics'), null, 'preview unmounts route metrics');
  assert.equal(host.querySelector('.route-mode-select'), null, 'preview unmounts route management controls');
  assert.equal(host.querySelector('.route-summary-detail'), null, 'preview unmounts expanded route details');
  assert.equal(host.querySelector('button.is-primary')?.textContent, '开始导航', 'preview retains the navigation action');
  await React.act(async () => host.querySelector('button.is-primary').click());
  assert.deepEqual(previewEvents, ['preview', 'start'], 'preview navigation calls onStartNavigation');
  assert.equal([...host.querySelectorAll('.route-preview-actions button')][0].textContent, '俯视');
  await React.act(async () => [...host.querySelectorAll('.route-preview-actions button')][0].click());
  assert.deepEqual(previewEvents, ['preview', 'start', 'toggle']);

  await React.act(async () => root.render(React.createElement(RouteResultSummary, summaryProps('top'))));
  assert.match(host.querySelector('[role="status"]').textContent, /路线预览（俯视）· 非定位导航/);
  assert.equal([...host.querySelectorAll('.route-preview-actions button')][0].textContent, '第一人称');
  await React.act(async () => [...host.querySelectorAll('.route-preview-actions button')][0].click());
  await React.act(async () => [...host.querySelectorAll('.route-preview-actions button')][1].click());
  assert.deepEqual(previewEvents, ['preview', 'start', 'toggle', 'toggle', 'exit']);

  await React.act(async () => root.render(React.createElement(RouteResultSummary, summaryProps(null))));
  assert.ok(host.querySelector('.route-summary-endpoints'), 'exiting preview restores route endpoints');
  assert.ok(host.querySelector('.route-summary-metrics'), 'exiting preview restores route metrics');
  assert.ok(host.querySelector('.route-mode-select'), 'exiting preview restores route management controls');
  assert.ok(host.querySelector('.route-summary-detail'), 'exiting preview restores mounted route details');
});
