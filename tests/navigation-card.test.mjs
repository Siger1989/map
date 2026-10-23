import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

async function loadGuidanceCard() {
  await build({
    entryPoints: ['modules/guidance/GuidanceCard.tsx'],
    outdir: '.openai/navigation-card-test',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  return (await import('../.openai/navigation-card-test/GuidanceCard.js')).GuidanceCard;
}

function setupDom() {
  const { window } = parseHTML('<html><body></body></html>');
  const old = {
    window: globalThis.window,
    document: globalThis.document,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
    resizeObserver: globalThis.ResizeObserver,
    bounds: window.HTMLElement.prototype.getBoundingClientRect,
  };
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ height: 180 });
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }
  Object.assign(globalThis, {
    window,
    document: window.document,
    ResizeObserver: ResizeObserverStub,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return {
    window,
    restore() {
      window.HTMLElement.prototype.getBoundingClientRect = old.bounds;
      if (old.window === undefined) delete globalThis.window;
      else globalThis.window = old.window;
      if (old.document === undefined) delete globalThis.document;
      else globalThis.document = old.document;
      if (old.actEnvironment === undefined) delete globalThis.IS_REACT_ACT_ENVIRONMENT;
      else globalThis.IS_REACT_ACT_ENVIRONMENT = old.actEnvironment;
      if (old.resizeObserver === undefined) delete globalThis.ResizeObserver;
      else globalThis.ResizeObserver = old.resizeObserver;
    },
  };
}

function makeGuidance() {
  return {
    session: {
      route: { mode: 'pedestrian' },
      departurePending: false,
      departureLength: 0,
      nextCheckpoint: 0,
      checkpoints: [],
      quality: '',
      offRoute: false,
      arrived: false,
      offSince: null,
      networkSwitched: false,
      offset: 0,
      travelled: 120,
      gap: false,
    },
    loading: false,
    departureMessage: '',
    rejoin: null,
    instruction: null,
    remaining: 880,
    online: true,
    error: '',
    replanning: false,
    replan() {},
    retry() {},
  };
}

test('navigation display settings replace card data and return to expanded navigation', async t => {
  const dom = setupDom();
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const GuidanceCard = await loadGuidanceCard();
  const host = document.createElement('div');
  host.className = 'observatory home-map';
  const mount = document.createElement('div');
  host.appendChild(mount);
  document.body.appendChild(host);
  const root = createRoot(mount);
  let displayCalls = 0;
  let closeDisplayCalls = 0;
  let followCalls = 0;
  let following = false;
  let displayPanel = null;
  const baseProps = {
    guidance: makeGuidance(),
    onStop() {},
    onFollow() { followCalls++; following = true; },
    onShow() {},
    get following() { return following; },
    onShare() {},
    onDisplay() { displayCalls++; },
    onCloseDisplay() { closeDisplayCalls++; },
    telemetry: React.createElement('section', { className: 'navigation-telemetry', 'data-testid': 'telemetry' }, '遥测数据'),
    compactTelemetry: React.createElement('section', { className: 'navigation-telemetry navigation-telemetry--compact', 'data-testid': 'compact-telemetry' }, '实时速度'),
    motionNotice: '运动方向稳定',
  };
  const render = async (overrides = {}) => act(async () => root.render(React.createElement(GuidanceCard, {
    ...baseProps,
    ...overrides,
    displayPanel,
  })));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.restore();
  });

  await render();
  assert.equal(host.querySelectorAll('.guidance-card').length, 1);
  assert.ok(host.querySelector('[data-testid="compact-telemetry"]'), 'compact telemetry lives inside the collapsed navigation card');
  assert.equal(host.querySelector('.guidance-compact-context')?.textContent, '实时速度运动方向稳定', 'motion feedback shares the compact card with speed data');
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /继续导航步行/);
  await render({ following: true, cameraWaiting: true });
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /等待定位步行/, 'waiting for a usable fix takes priority over requested follow');
  assert.doesNotMatch(host.querySelector('.guidance-follow-status')?.textContent, /导航跟随中/);
  const priorityStates = [
    [g => { g.error = '路线服务错误'; }, '路线服务错误'],
    [g => { g.session.quality = '定位精度不足'; }, '定位精度不足'],
    [g => { g.session.offRoute = true; g.session.offset = 75; }, '已偏离约75 米'],
    [g => { g.session.departurePending = true; g.departureMessage = '正在接近起点'; }, '正在接近起点'],
    [g => { g.session.arrived = true; }, '已到达终点'],
  ];
  for (const [mutate, expected] of priorityStates) {
    const guidance = makeGuidance();
    mutate(guidance);
    await render({ guidance, motionNotice: '运动方向等待确认' });
    assert.match(host.querySelector('.guidance-compact-context')?.textContent ?? '', new RegExp(expected));
    assert.doesNotMatch(host.querySelector('.guidance-compact-context')?.textContent ?? '', /运动方向等待确认/, 'priority route state is not covered by auxiliary motion guidance');
  }
  await render();
  await act(async () => host.querySelector('[aria-label="展开导航详情"]').click());
  assert.equal(host.querySelector('.guidance-inline-status')?.textContent, '运动方向稳定', 'the motion notice remains available in expanded details');
  const followAction = [...host.querySelectorAll('.guidance-actions button')].find(button => button.textContent.includes('继续导航'));
  assert.ok(followAction, 'following can still be resumed from expanded details');
  await act(async () => followAction.click());
  assert.equal(followCalls, 1, 'the navigation heading invokes the real follow callback');
  await render();
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /导航跟随中步行/);
  assert.ok(host.querySelector('.navigation-telemetry'), 'ordinary expansion shows telemetry');
  assert.equal(host.querySelector('[data-testid="compact-telemetry"]'), null, 'expanded details use the original telemetry slot without duplicating compact data');
  assert.ok(host.querySelector('[data-testid="guidance-travelled"]'), 'ordinary expansion shows route data');

  await act(async () => host.querySelector('[aria-label="导航路线显示设置"]').click());
  assert.equal(displayCalls, 1, 'the display action asks the parent to provide the embedded panel');
  displayPanel = React.createElement('div', { 'data-testid': 'embedded-display-panel' }, '路线显示设置内容');
  await render();
  assert.equal(host.querySelectorAll('.guidance-card').length, 1, 'display settings stay in the same card');
  assert.equal(host.querySelector('.navigation-telemetry'), null, 'embedded settings replace navigation telemetry');
  assert.equal(host.querySelector('.guidance-content'), null, 'embedded settings replace ordinary navigation details');
  assert.equal(host.querySelector('[data-testid="embedded-display-panel"]')?.textContent, '路线显示设置内容');
  assert.equal(host.querySelector('.guidance-heading-row strong')?.textContent.trim(), '路线显示');

  await act(async () => host.querySelector('[aria-label="返回导航详情"]').click());
  assert.equal(closeDisplayCalls, 1, 'the header return action closes the embedded panel');
  displayPanel = null;
  await render();
  assert.equal(host.querySelectorAll('.guidance-card').length, 1);
  assert.ok(host.querySelector('.navigation-telemetry'), 'return restores the expanded telemetry');
  assert.ok(host.querySelector('[data-testid="guidance-travelled"]'), 'return restores expanded route details');
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /导航跟随中步行/);
});
