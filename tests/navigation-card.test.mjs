import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { readFile } from 'node:fs/promises';

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

test('expanded navigation keeps its title in place and scrolls details inside the bounded card', async () => {
  const css = await readFile('modules/guidance/guidance.css', 'utf8');
  assert.match(css, /\.guidance-card\[data-expanded='true'\]\s*\{\s*max-height:min\(360px/s);
  assert.match(css, /\.guidance-card\[data-expanded='true'\] \.guidance-content\s*\{[^}]*min-height:0; overflow:auto/s);
  assert.match(css, /\.guidance-card\[data-expanded='true'\] \.guidance-inline-status\s*\{\s*max-height:64px; overflow:auto/s);
  assert.doesNotMatch(css, /\.guidance-card\[data-expanded='true'\]\s*\{[^}]*overflow:\s*visible/s);
});

test('progress rail stays a narrow vertical line and no longer auto-switches to horizontal', async () => {
  const css = await readFile('modules/guidance/guidanceProgress.css', 'utf8');
  assert.match(css, /\.guidance-progress-rail\s*\{[^}]*flex-direction:column;[^}]*width:32px;[^}]*height:min\(220px/s);
  assert.match(css, /\.guidance-progress-track\s*\{[^}]*width:3px/s);
  assert.doesNotMatch(css, /is-compact|flex-direction:\s*row/);
  const cardCss = await readFile('modules/guidance/guidance.css', 'utf8');
  assert.match(cardCss, /:has\(\.guidance-card\[data-expanded='true'\]\) \.guidance-progress-rail\s*\{\s*display:none/s);
  const component = await readFile('modules/guidance/GuidanceProgressRail.tsx', 'utf8');
  assert.doesNotMatch(component, /ResizeObserver|isCompact|is-compact/);
});

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
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /恢复跟随步行/);
  assert.equal(host.querySelector('.guidance-follow-status')?.getAttribute('aria-label'), '恢复跟随');
  await render({ following: true, cameraWaiting: true });
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /当前位置步行/);
  assert.equal(host.querySelector('.guidance-follow-status')?.getAttribute('aria-label'), '当前位置');
  const waiting = makeGuidance();
  waiting.session.quality = '等待当前位置…';
  waiting.session.departurePending = true;
  waiting.departureMessage = '定位精度约±50000米，等待准确位置';
  let cameraCalls = 0;
  for (const cameraMode of ['top', 'forward']) {
    await render({ guidance: waiting, cameraWaiting: true, cameraMode, onFirstPerson: () => { cameraCalls++; }, motionNotice: '等待新定位，运动方向保持不变' });
    const visibleState = host.querySelector(cameraMode === 'top' ? '.guidance-compact-context [role="status"]' : '.guidance-compact-primary [role="status"]');
    assert.equal(visibleState?.textContent, waiting.departureMessage, 'collapsed navigation retains the specific departure failure in both views');
    assert.equal(host.querySelector('[data-testid="compact-telemetry"]'), null, 'waiting replaces empty speed placeholders');
    assert.equal(host.querySelector('.guidance-expand')?.getAttribute('aria-expanded'), 'false', 'the reason is visible without opening details');
    assert.equal(host.querySelector('.guidance-maneuver-icon'), null, 'waiting must not invent a direction arrow');
    const camera = host.querySelector('.guidance-first-person');
    assert.equal(camera.textContent, cameraMode === 'forward' ? '前视' : '俯视');
    assert.match(camera.title, /定位就绪后跟随/);
    await act(async () => camera.click());
  }
  assert.equal(cameraCalls, 2, 'both labeled views still use the real camera callback');
  const turning = makeGuidance();
  turning.instruction = { text: '前方右转', distance: 80 };
  await render({ guidance: turning, cameraMode: 'forward' });
  assert.ok(host.querySelector('.guidance-maneuver-icon .lucide-corner-up-right'), 'a known turn retains its maneuver arrow');
  turning.instruction = { text: '前往道路接入点', distance: 80 };
  await render({ guidance: turning, cameraMode: 'forward' });
  assert.equal(host.querySelector('.guidance-maneuver-icon'), null, 'unknown instructions do not get a default heading arrow');
  waiting.session.departurePending = false;
  await render({ guidance: waiting, cameraWaiting: true, motionNotice: '等待新定位，运动方向保持不变' });
  assert.equal(host.querySelector('.guidance-compact-context [role="status"]')?.textContent, '等待当前位置…', 'camera waiting must not suppress the generic location reason either');
  waiting.session.arrived = true;
  await render({ guidance: waiting, cameraWaiting: true });
  assert.equal(host.querySelector('.guidance-compact-context [role="status"]')?.textContent, '已到达终点', 'arrival is retained even when the last location has gone stale');
  await render();
  assert.ok(host.querySelector('[data-testid="compact-telemetry"]'), 'speed information returns when the waiting state clears');
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
    if (guidance.error) {
      assert.equal(host.querySelector('.guidance-error-open')?.textContent, '接入路线失败 · 查看详情');
      assert.doesNotMatch(host.querySelector('.guidance-compact-context')?.textContent ?? '', /路线服务错误/, 'compact error text is summarized once');
      await act(async () => host.querySelector('.guidance-error-open').click());
      assert.equal(host.querySelector('[role="alert"]')?.textContent, '路线服务错误', 'expanded details show the full error');
      await act(async () => host.querySelector('[aria-label="收起导航详情"]').click());
    } else {
      assert.match(host.querySelector('.guidance-compact-context')?.textContent ?? '', new RegExp(expected));
      assert.doesNotMatch(host.querySelector('.guidance-compact-context')?.textContent ?? '', /运动方向等待确认/, 'priority route state is not covered by auxiliary motion guidance');
    }
  }
  const offRoute = makeGuidance();
  offRoute.session.offRoute = true;
  offRoute.returnToOriginalSupported = true;
  let returnCalls = 0, showCalls = 0, endCalls = 0;
  offRoute.returnToOriginal = () => { returnCalls++; };
  const renderShortcut = () => render({ guidance: offRoute, onShow: () => { showCalls++; }, onStop: () => { endCalls++; } });
  const shortcut = () => host.querySelector('.guidance-quick-action button');
  await renderShortcut();
  assert.equal(shortcut()?.textContent, '接回原路线');
  await act(async () => shortcut().click());
  assert.equal(returnCalls, 1);
  offRoute.rejoin = {};
  await renderShortcut();
  assert.equal(shortcut()?.textContent, '查看接回路径');
  await act(async () => shortcut().click());
  assert.equal(showCalls, 1);
  offRoute.session.quality = '定位精度不足';
  await renderShortcut();
  assert.equal(shortcut(), null);
  offRoute.session.arrived = true;
  await renderShortcut();
  assert.equal(shortcut()?.textContent, '结束导航');
  assert.equal([...host.querySelectorAll('button')].filter(b => b.textContent === '结束导航').length, 1);
  await act(async () => shortcut().click());
  assert.equal(endCalls, 1);
  await render();
  await act(async () => host.querySelector('[aria-label="展开导航详情"]').click());
  assert.equal(host.querySelector('.guidance-card')?.getAttribute('data-expanded'), 'true', 'expanded details stay within the viewport-bounded card');
  assert.equal(host.querySelector('.guidance-inline-status')?.textContent, '运动方向稳定', 'the motion notice remains available in expanded details');
  const followAction = host.querySelector('.guidance-follow-status');
  assert.ok(followAction, 'the fixed header remains the single current-location/follow action');
  assert.equal(host.querySelectorAll('.guidance-actions button').length > 0, true);
  assert.equal([...host.querySelectorAll('.guidance-actions button')].some(button => /^(恢复跟随|当前位置)$/.test(button.textContent)), false, 'expanded details do not duplicate the follow action');
  await act(async () => followAction.click());
  assert.equal(followCalls, 1, 'the navigation heading invokes the real follow callback');
  const departure = makeGuidance();
  departure.session.departurePending = true;
  let retryCalls = 0;
  departure.retry = () => { retryCalls++; };
  await render({ guidance: departure });
  const originPlan = [...host.querySelectorAll('.guidance-actions button')].find(button => button.textContent.includes('先去路线起点'));
  assert.ok(originPlan, 'pending departure exposes a route-to-origin action');
  assert.equal(originPlan.title, '当前位置 → 原路线起点；不会改写原路线');
  assert.match(host.querySelector('.guidance-departure-note')?.textContent, /先去起点.*保留途经点/);
  assert.equal([...host.querySelectorAll('.guidance-actions button')].find(button => button.textContent.includes('从当前位置重算'))?.disabled, false,
    'planning to the destination remains available while access to the original start is pending');
  await act(async () => originPlan.click());
  assert.equal(retryCalls, 1, 'planning to the original start uses the existing retry function');
  const destinationPlan = makeGuidance();
  let replanCalls = 0;
  destinationPlan.replan = () => { replanCalls++; };
  await render({ guidance: destinationPlan });
  const toDestination = [...host.querySelectorAll('.guidance-actions button')].find(button => button.textContent.includes('从当前位置重算'));
  assert.equal(toDestination.title, '从当前位置重新规划，保留未到途经点和原终点，不改写原路线');
  await act(async () => toDestination.click());
  assert.equal(replanCalls, 1, 'destination replanning keeps the existing replan function');
  await render();
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /当前位置步行/);
  assert.ok(host.querySelector('.navigation-telemetry'), 'ordinary expansion shows telemetry');
  assert.equal(host.querySelector('[data-testid="compact-telemetry"]'), null, 'expanded details use the original telemetry slot without duplicating compact data');
  assert.ok(host.querySelector('[data-testid="guidance-travelled"]'), 'ordinary expansion shows route data');
  assert.ok(host.querySelector('.guidance-actions button[aria-label="导航路线显示设置"]'), 'expanded actions remain directly in the card without a separate scroll gate');

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
  assert.match(host.querySelector('.guidance-follow-status')?.textContent, /当前位置步行/);
});
