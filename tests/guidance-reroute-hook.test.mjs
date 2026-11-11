import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';
import { navigationStartPlace } from '../modules/guidance/routeStart.ts';

const output = '.openai/guidance-reroute-hook/hook-test.mjs';
await build({
  entryPoints: ['modules/guidance/useGuidance.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  plugins: [{
    name: 'route-planner-stub',
    setup(builder) {
      builder.onResolve({ filter: /navigation\/provider/ }, () => ({ path: 'route-provider', namespace: 'guidance-test' }));
      builder.onLoad({ filter: /.*/, namespace: 'guidance-test' }, () => ({
        contents: 'export const planRoute = (...args) => globalThis.__guidancePlanner(...args);',
        loader: 'js',
      }));
    },
  }],
});

const { useGuidance } = await import(`${pathToFileURL(`${process.cwd()}/${output}`).href}?test=${Date.now()}`);
const { shouldAutoReroute } = await import('../modules/guidance/reroute.ts');
const React = await import('react');
const { createRoot } = await import('react-dom/client');

const route = () => ({
  mode: 'bicycle',
  coordinates: [[103, 30], [103.01, 30], [103.02, 30], [103.03, 30]],
  snapped: [[103, 30], [103.01, 30], [103.02, 30], [103.03, 30]],
  stops: [
    { name: '起点', coordinates: [103, 30] },
    { name: '途经一', coordinates: [103.01, 30] },
    { name: '途经二', coordinates: [103.02, 30] },
    { name: '原终点', coordinates: [103.03, 30] },
  ],
  distance: 2900,
  duration: 900,
  steps: [],
  createdAt: 1,
});
const fixAt = (timestamp, coordinates = [103, 30]) => ({ coordinates, timestamp, accuracy: 5, source: 'gps' });
const coordinatesNear = (actual, expected) => assert.ok(
  Math.abs(actual[0] - expected[0]) < 1e-8 && Math.abs(actual[1] - expected[1]) < 1e-8,
  `expected ${JSON.stringify(actual)} to remain at ${JSON.stringify(expected)}`,
);

async function mount(t, planner) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const originals = new Map();
  for (const key of ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT', 'Date'])
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  let now = 1_800_000_000_000;
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  const timers = new Map();
  let nextTimer = 1;
  window.setTimeout = (callback, delay = 0) => {
    const id = nextTimer++;
    timers.set(id, { callback, at: now + delay });
    return id;
  };
  window.clearTimeout = (id) => timers.delete(id);
  window.setInterval = () => nextTimer++;
  window.clearInterval = () => {};
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  Object.defineProperty(window, 'navigator', { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true });
  globalThis.__guidancePlanner = planner;

  let state, updateProps, refresh;
  function Probe() {
    const [props, setProps] = React.useState({ route: route(), fix: fixAt(now), error: '' });
    const [, bump] = React.useState(0);
    updateProps = setProps;
    refresh = () => bump((value) => value + 1);
    state = useGuidance(props.route, props.fix, props.error);
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Probe)));
  const runDueTimers = async () => {
    let executed = true;
    while (executed) {
      executed = false;
      for (const [id, timer] of timers) {
        if (timer.at <= now) {
          timers.delete(id);
          await React.act(async () => timer.callback());
          executed = true;
          break;
        }
      }
    }
  };
  const setFix = async (fix) => React.act(async () => { updateProps((props) => ({ ...props, fix })); refresh(); });
  const setTime = async (value) => { now = value; await runDueTimers(); };
  const api = {
    get state() { return state; },
    timers,
    now: () => now,
    setFix,
    setTime,
    async start() { await React.act(async () => state.start()); },
  };
  t.after(async () => {
    await React.act(async () => root.unmount());
    delete globalThis.__guidancePlanner;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return api;
}

test('a moving off-route fix invalidates a stale request and retries from the latest GPS while preserving remaining places', async (t) => {
  const calls = [];
  const replies = [];
  const app = await mount(t, (...args) => {
    calls.push(args);
    return new Promise((resolve, reject) => replies.push({ resolve, reject }));
  });
  const original = route();
  await app.start();
  await app.setFix(fixAt(app.now(), [103, 30]));
  await app.setTime(app.now() + 10000);
  await app.setFix(fixAt(app.now(), [103.0015, 30.0015]));
  await app.setTime(app.now() + 4000);
  await app.setFix(fixAt(app.now(), [103.0015, 30.0015]));
  assert.equal(app.state.session.offRoute, true);
  assert.equal(calls.length, 1, JSON.stringify({ eligible: shouldAutoReroute(app.state.session, app.state.session.last, { now: app.now(), online: true, hidden: false, pending: false, nextRequestAt: 0 }), active: app.state.active, online: app.state.online, offRoute: app.state.session.offRoute, quality: app.state.session.quality, pending: app.state.loading, last: app.state.session.last, fixAt: app.now(), offset: app.state.session.offset }));
  assert.deepEqual(calls[0][1].coordinates, original.stops.at(-1).coordinates);
  calls[0][4].forEach((place, i) => coordinatesNear(place.coordinates, original.stops[i + 1].coordinates));

  const moved = [103.0015, 30.0025];
  await app.setTime(app.now() + 4000);
  await app.setFix(fixAt(app.now(), moved));
  const stale = { ...route(), coordinates: [[103.0015, 30.0015], [103.01, 30], [103.02, 30], [103.03, 30]], snapped: [[103.0015, 30.0015], [103.01, 30], [103.02, 30], [103.03, 30]] };
  await React.act(async () => replies[0].resolve(stale));
  assert.deepEqual(app.state.session.originalRoute.stops, original.stops);
  assert.match(app.state.error, /位置已变化/);

  await app.setTime(app.now() + 15000);
  await app.setFix(fixAt(app.now(), moved));
  assert.equal(calls.length, 2, 'cooldown expiry wakes the hook without requiring a new route or user retry');
  assert.deepEqual(calls[1][0].coordinates, moved, 'the retry starts at the latest reliable GPS fix');
  assert.deepEqual(calls[1][1].coordinates, original.stops.at(-1).coordinates);
  calls[1][4].forEach((place, i) => coordinatesNear(place.coordinates, original.stops[i + 1].coordinates));
  const rerouted = { ...route(), stops: [calls[1][0], ...calls[1][4], calls[1][1]],
    coordinates: [moved, ...calls[1][4].map(p => p.coordinates), calls[1][1].coordinates],
    snapped: [moved, ...calls[1][4].map(p => p.coordinates), calls[1][1].coordinates] };
  await React.act(async () => replies[1].resolve(rerouted));
  assert.equal(app.state.session.replanned, true);
  assert.deepEqual(app.state.session.route.coordinates[0], moved);
  assert.deepEqual(navigationStartPlace(app.state.session, null), original.stops[0], 'automatic rerouting keeps the original map start');
});

test('successive manual reroutes keep the journey start while routing from each latest fix', async (t) => {
  const calls = [];
  const app = await mount(t, async (start, end, mode, signal, via = []) => {
    calls.push(start);
    const stops = [start, ...via, end];
    return { ...route(), mode, stops, coordinates: stops.map(p => p.coordinates), snapped: stops.map(p => p.coordinates) };
  });
  await app.start();
  const original = app.state.session.originalRoute;
  const snapshot = structuredClone(original);
  for (const position of [[103.002, 30], [103.004, 30]]) {
    await app.setTime(app.now() + 1000);
    await app.setFix(fixAt(app.now(), position));
    await React.act(async () => app.state.replan());
    assert.deepEqual(calls.at(-1).coordinates, position);
    assert.deepEqual(app.state.session.route.coordinates[0], position);
    assert.deepEqual(navigationStartPlace(app.state.session, null), original.stops[0]);
    assert.deepEqual(app.state.session.route.stops.at(-1), original.stops.at(-1));
    assert.deepEqual(original, snapshot);
  }
});

test('legacy routes without stop metadata retain their original start coordinates and name fallback', () => {
  const original = route();
  delete original.stops;
  const session = { originalRoute: original };
  const fallback = { name: '出发地点', coordinates: original.coordinates[0] };
  assert.deepEqual(navigationStartPlace(session, fallback), fallback);
  assert.deepEqual(navigationStartPlace(session, null), { name: '起点', coordinates: original.coordinates[0] });
});

test('a failed planner request automatically retries after its bounded backoff using fresh GPS', async (t) => {
  const calls = [];
  const replies = [];
  const app = await mount(t, (...args) => {
    calls.push(args);
    return new Promise((resolve, reject) => replies.push({ resolve, reject }));
  });
  await app.start();
  await app.setFix(fixAt(app.now(), [103, 30]));
  await app.setTime(app.now() + 10000);
  await app.setFix(fixAt(app.now(), [103.0015, 30.0015]));
  await app.setTime(app.now() + 4000);
  await app.setFix(fixAt(app.now(), [103.0015, 30.0015]));
  assert.equal(calls.length, 1);
  await React.act(async () => replies[0].reject(new Error('临时服务不可用')));
  assert.match(app.state.error, /临时服务不可用/);

  await app.setTime(app.now() + 15000);
  await app.setFix(fixAt(app.now(), [103.0015, 30.0015]));
  assert.equal(calls.length, 2, 'the first network failure retries after 15 seconds');
  await React.act(async () => replies[1].reject(new Error('再次暂时不可用')));
  await app.setTime(app.now() + 30000);
  await app.setFix(fixAt(app.now(), [103.0015, 30.0015]));
  assert.equal(calls.length, 3, 'repeated network failure backs off to 30 seconds');
  await React.act(async () => replies[2].reject(new Error('第三次暂时不可用')));
  await app.setTime(app.now() + 45000);
  await app.setFix(fixAt(app.now(), [103.0015, 30.0015]));
  assert.equal(calls.length, 4, 'retries cap at 45 seconds after repeated failures');
});


test('an indoor device fix can connect the start and manually replan without advancing navigation until GPS returns', async (t) => {
  const calls = [];
  const replies = [];
  const app = await mount(t, (start, end, mode, signal, via = []) => {
    calls.push({ start, end, mode, signal, via });
    return new Promise(resolve => replies.push(() => {
      const stops = [start, ...via, end];
      const coordinates = stops.map(place => place.coordinates);
      resolve({ ...route(), mode, stops, coordinates, snapped: coordinates });
    }));
  });
  const network = (coordinates, accuracy = 240) => ({ ...fixAt(app.now(), coordinates), source: 'network', accuracy, speed: 15 });
  const origin = [102.998, 30];
  await app.setFix(network(origin));
  await app.start();
  const original = app.state.session.originalRoute;
  const snapshot = structuredClone(original);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].start.coordinates, origin);
  assert.deepEqual(calls[0].end.coordinates, original.stops[0].coordinates);
  await React.act(async () => replies[0]());
  assert.equal(app.state.session.departurePending, false);
  assert.equal(app.state.session.last, null);
  assert.equal(app.state.session.progress, 0);
  assert.match(app.state.session.quality, /网络估算.*240米/);

  let replan;
  await React.act(async () => { replan = app.state.replan(); });
  assert.equal(calls.length, 2);
  assert.equal(app.state.replanning, true);
  calls[1].via.forEach((place, i) => coordinatesNear(place.coordinates, original.stops[i + 1].coordinates));
  await app.setTime(app.now() + 1_000);
  await app.setFix(network(origin, 25));
  assert.equal(calls[1].signal.aborted, false, 'automatic navigation must not cancel a manual request during poor location quality');
  await React.act(async () => { replies[1](); await replan; });
  assert.equal(app.state.session.replanned, true);
  assert.equal(app.state.session.last, null);
  assert.equal(app.state.session.anchor, null);
  assert.equal(app.state.session.travelled, 0);
  assert.equal(app.state.session.positionAssessment, undefined);

  await app.setTime(app.now() + 1_000);
  await app.setFix(network(original.stops.at(-1).coordinates, 25));
  assert.equal(app.state.session.arrived, false);
  assert.equal(app.state.session.offRoute, false);
  assert.equal(app.state.session.travelled, 0);
  assert.equal(calls.length, 2, 'coarse fixes never trigger automatic reroute');

  await app.setTime(app.now() + 1_000);
  await app.setFix(fixAt(app.now(), [102.999, 30]));
  assert.equal(app.state.session.quality, '');
  assert.ok(app.state.session.progress > 50);
  assert.equal(app.state.session.travelled, 0, 'the GPS recovery fix must not bridge distance across coarse readings');
  assert.deepEqual(original, snapshot);
});

test('a manual return to the original route accepts a device estimate but an IP replacement cannot overwrite the current route', async (t) => {
  const calls = [];
  const replies = [];
  const app = await mount(t, (start, end, mode, signal, via = []) => {
    calls.push({ start, end, signal });
    return new Promise(resolve => replies.push(() => {
      const stops = [start, ...via, end];
      const coordinates = stops.map(place => place.coordinates);
      resolve({ ...route(), mode, stops, coordinates, snapped: coordinates });
    }));
  });
  await app.start();
  const original = app.state.session.originalRoute;
  const network = { ...fixAt(app.now() + 1_000, [103, 30.001]), source: 'network', accuracy: 200 };
  await app.setTime(network.timestamp);
  await app.setFix(network);
  let pending;
  await React.act(async () => { pending = app.state.returnToOriginal(); });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].start.coordinates, network.coordinates);
  await app.setTime(app.now() + 1_000);
  await app.setFix({ ...network, timestamp: app.now(), provider: 'ip' });
  assert.equal(calls[0].signal.aborted, false);
  await React.act(async () => { replies[0](); await pending; });
  assert.match(app.state.error, /仅有 IP/);
  assert.equal(app.state.session.route, original);
  assert.equal(app.state.rejoin, null);

  await app.setTime(app.now() + 1_000);
  await app.setFix({ ...network, timestamp: app.now() });
  await React.act(async () => { pending = app.state.returnToOriginal(); });
  await React.act(async () => { replies[1](); await pending; });
  assert.equal(app.state.session.route, original);
  assert.deepEqual(app.state.rejoin.origin.coordinates, network.coordinates);
  assert.match(app.state.session.quality, /网络估算.*200米/);
  assert.equal(app.state.session.anchor, null);
  assert.equal(app.state.session.offSince, null);
  assert.equal(app.state.session.offRoute, false, 'the manually planned path does not confirm a deviation');
});


test('an estimated origin already at the selected start waits for GPS without requesting a zero-length connection', async (t) => {
  const app = await mount(t, () => { assert.fail('zero-length connection should not call the planner'); });
  await app.setFix({ ...fixAt(app.now()), source: 'network', accuracy: 300 });
  await app.start();
  assert.equal(app.state.session.departurePending, true);
  assert.match(app.state.departureMessage, /网络估算.*300米/);
  assert.equal(app.state.error, '');
  await app.setTime(app.now() + 1_000);
  await app.setFix(fixAt(app.now()));
  assert.equal(app.state.session.departurePending, false);
  assert.equal(app.state.session.progress, 0);
});
