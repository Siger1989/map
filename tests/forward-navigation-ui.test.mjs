import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
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
    steps: [
      { instruction: '沿路线前进', distance: 400, duration: 100 },
      { instruction: '向右转', distance: 600, duration: 200 },
    ],
    stops: [{ name: '起点', coordinates: [104, 30] }, { name: '终点', coordinates: [104.001, 30.001] }],
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

  await React.act(async () => root.render(React.createElement(GuidanceCard, { ...cardProps(), cameraMode: undefined })));
  assert.equal(host.querySelector('.guidance-compact-primary'), null, 'ordinary navigation defaults to a clear top view');
  assert.equal(host.querySelectorAll('.guidance-header-actions button').length, 1, 'the collapsed header has only the 44px more button');
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /继续导航 · 步行/);
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('.guidance-compact-primary')?.getAttribute('data-maneuver'), 'straight');
  assert.equal(host.querySelector('.guidance-maneuver-distance')?.textContent, '500 米');
  assert.equal(host.querySelector('.guidance-maneuver-text')?.textContent, '沿路线前进');
  assert.equal(host.querySelector('.guidance-remaining-line')?.textContent, '全程剩余 1.0 公里', 'remaining route distance is secondary and labeled as total remaining');
  assert.equal(host.querySelector('.guidance-actions [aria-label="第一人称模式"]')?.getAttribute('aria-pressed'), 'true', 'first-person stays available in details');
  assert.ok(host.querySelector('.guidance-actions button:last-child'), 'ending navigation remains available in details');
  await React.act(async () => root.render(React.createElement(GuidanceCard, { ...cardProps(), following: true })));
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /导航跟随中 · 步行/);
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  session.last = { coordinates: [104.001, 30], accuracy: 8, timestamp: Date.now() };
  session.offset = 20;
  guidance.remaining = 700;
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.match(host.textContent, /距规划线约20 米 · 尚未确认偏航/);
  assert.equal(session.offRoute, false, 'nearby-road information must not declare confirmed deviation');
  for (const source of ['network', 'ip']) {
    session.last = {
      coordinates: [104.001, 30], accuracy: 8, timestamp: Date.now(),
      ...(source === 'network' ? { source: 'network' } : { provider: 'ip' }),
    };
    await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  }
  session.last = { coordinates: [104.001, 30], accuracy: 8, timestamp: Date.now(), source: 'gps' };
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  session.quality = '定位精度不足';
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.doesNotMatch(host.textContent, /距规划线约20/);
  session.quality = ''; session.offset = 0;
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('[aria-label*="路书"]'), null, 'the original roadbook entry is absent');
  assert.doesNotMatch(host.textContent, /路书/);
  assert.equal(host.querySelector('[data-position-assessment]'), null, 'assessments do not replace the label unless the nearby-offset state is valid');
  session.offset = 20;
  await React.act(async () => root.render(React.createElement(GuidanceCard, {
    ...cardProps(), positionAssessment: { kind: 'parallel', message: '位置在平行道路，尚未确认偏航' },
  })));
  assert.equal(host.querySelector('[data-position-assessment="parallel"]')?.textContent, '位置在平行道路，尚未确认偏航');
  assert.equal(host.querySelector('[role="note"]'), null, 'the reference explanation is available in expanded details');
  assert.deepEqual([...host.querySelectorAll('.guidance-header-actions button')].map((button) => button.getAttribute('aria-label')),
    ['展开导航详情']);
  session.positionAssessment = { kind: 'uncertain', message: '正在确认位置' };
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('[data-position-assessment="uncertain"]')?.textContent, '正在确认位置', 'the session assessment is used when the prop is absent');
  assert.equal(host.querySelector('[role="note"]'), null);
  session.positionAssessment = { kind: 'away', message: '正在远离规划线 · 待确认偏航', allowReference: false };
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('[data-position-assessment="away"]')?.textContent, '正在远离规划线 · 待确认偏航');
  assert.equal(host.querySelector('[role="note"]'), null, 'away motion suppresses the yellow direction-reference note');
  delete session.positionAssessment;
  session.offset = 0;
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  await React.act(async () => host.querySelector('[aria-label="展开导航详情"]').click());
  await React.act(async () => host.querySelector('.guidance-actions [aria-label="第一人称模式"]').click());
  assert.deepEqual(firstPersonCalls, ['first-person'], 'the header action calls the first-person callback');
  await React.act(async () => host.querySelector('[aria-label="收起导航详情"]').click());
  await React.act(async () => root.render(React.createElement(GuidanceCard, {
    ...cardProps(), viewNotice: '第一人称路线预览 · 非定位导航，等待准确定位',
  })));
  assert.match(host.querySelector('header').textContent, /非定位导航，等待准确定位/, 'waiting for GPS still gives visible preview feedback');
  assert.equal(host.querySelector('.guidance-compact-primary')?.getAttribute('data-maneuver'), 'straight', 'view notices do not suppress the next maneuver');
  assert.equal(host.querySelector('.guidance-compact-state'), null, 'view notice is auxiliary rather than the primary direction');
  assert.equal(host.querySelector('.guidance-inline-status')?.textContent, '第一人称路线预览 · 非定位导航，等待准确定位');
  await React.act(async () => root.render(React.createElement(GuidanceCard, {
    ...cardProps(), guidance: { ...guidance, session: { ...session, quality: '定位精度不足' } },
    viewNotice: '第一人称路线预览 · 非定位导航，等待准确定位',
  })));
  assert.equal(host.querySelector('.guidance-compact-state')?.textContent, '定位精度不足', 'GPS quality takes priority over the auxiliary view notice');
  assert.equal(host.querySelector('.guidance-inline-status'), null, 'first-person primary state is not duplicated in the auxiliary status row');

  let cameraButton = [...host.querySelectorAll('.guidance-camera-mode')][0];
  assert.equal(cameraButton.textContent, '切换俯视');
  await React.act(async () => cameraButton.click());
  assert.deepEqual(cameraModeCalls, ['top']);
  cameraMode = 'top';
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('.guidance-first-person').getAttribute('aria-pressed'), 'false');
  assert.equal(host.querySelector('.guidance-compact-primary'), null, 'top view has no direction panel');
  assert.equal(host.querySelector('.guidance-trip-summary'), null, 'no bottom metrics overlay in either mode');
  cameraButton = host.querySelector('.guidance-camera-mode');
  assert.equal(cameraButton.textContent, '切换前视');
  await React.act(async () => cameraButton.click());
  assert.deepEqual(cameraModeCalls, ['top', 'forward']);
  cameraMode = 'forward';
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));

  const css = await readFile('modules/guidance/guidance.css', 'utf8');
  assert.match(css, /\.guidance-card header button\s*\{[^}]*min-width:\s*44px;[^}]*height:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(css, /\.guidance-content\s*\{[\s\S]*?overflow:\s*auto;/);
  assert.match(css, /\.observatory\.home-map \.guidance-card\s*\{[\s\S]*?overflow:\s*visible;/);
  assert.match(css, /\.observatory\.home-map \.guidance-card\[data-compact='true'\]\s*\{[^}]*width:min\(300px/s);
  assert.match(css, /--normal-nav-rail-top:\s*calc\(var\(--home-top\) \+ var\(--home-header-height\) \+ 4px/);
  assert.match(css, /\.guidance-card\[data-compact='true'\] header button\.guidance-expand\s*\{[^}]*width:\s*32px/s, 'compact expand control fits beside follow in the same row');
  assert.doesNotMatch(css, /background:\s*#204da8/i, 'first-person mode does not recolour the whole card blue');
  assert.match(css, /\.guidance-compact-context[\s\S]*?\.navigation-telemetry--compact/, 'compact telemetry is styled within the shared card context');
  assert.doesNotMatch(css, /\.global-focus-lock\s*\{/);

  guidance.instruction = null;
  guidance.remaining = 27600;
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('.guidance-maneuver-text')?.textContent, '沿路线前往终点', 'missing turn data is described as route guidance to the destination');
  assert.equal(host.querySelector('.guidance-maneuver-distance')?.textContent, '27.6 公里', 'the endpoint distance is presented as route distance, not a next turn');
  assert.equal(host.querySelector('.guidance-remaining-line'), null, 'the same endpoint distance is not repeated as a second metric');
  guidance.instruction = { distance: 27600, text: '沿路线前进' };
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('.guidance-maneuver-text')?.textContent, '沿路线前往终点', 'an all-route straight instruction is not presented as a useful next turn');
  assert.equal(host.querySelector('.guidance-maneuver-distance')?.textContent, '27.6 公里');
  assert.equal(host.querySelector('.guidance-remaining-line'), null);
  guidance.instruction = { distance: 27600, text: '到达终点' };
  await React.act(async () => root.render(React.createElement(GuidanceCard, cardProps())));
  assert.equal(host.querySelector('.guidance-maneuver-text')?.textContent, '沿路线前往终点', 'arrival-distance text also falls back to a clearly labeled route target');
  assert.equal(host.querySelector('.guidance-remaining-line'), null);

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
  assert.equal(host.querySelector('.route-summary-endpoints'), null, 'endpoints stay inside collapsed details');
  assert.equal(host.querySelector('.route-mode-select'), null, 'route mode stays inside collapsed details');
  assert.equal(host.querySelectorAll('.route-summary-actions')[0].querySelectorAll('button').length, 3, 'first action row has three controls');
  assert.equal(host.querySelectorAll('.route-summary-actions')[1].querySelectorAll('button').length, 3, 'second action row has three controls');
  await React.act(async () => host.querySelector('[aria-expanded="false"]').click());
  assert.ok(host.querySelector('.route-summary-detail'), 'route details can be opened before preview');
  assert.ok(host.querySelector('.route-summary-endpoints'), 'details reveal editable route endpoints');
  assert.ok(host.querySelector('.route-mode-select'), 'details reveal route mode');
  await React.act(async () => [...host.querySelectorAll('.route-summary-detail button')].find((button) => button.textContent === '第一人称预览').click());
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
