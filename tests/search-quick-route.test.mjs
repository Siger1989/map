import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const output = '.openai/search-quick-route/useNavigation-test.mjs';
await build({
  entryPoints: ['modules/navigation/useNavigation.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  plugins: [{
    name: 'mock-navigation-provider',
    setup(builder) {
      builder.onResolve({ filter: /\.\/provider$/ }, () => ({ path: 'route-provider', namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({
        contents: 'export const planRoute = (...args) => globalThis.__planRoute(...args);',
        loader: 'js',
      }));
    },
  }],
});

const { useNavigation } = await import(`${pathToFileURL(`${process.cwd()}/${output}`).href}?test=${Date.now()}`);
const React = await import('react');
const { createRoot } = await import('react-dom/client');

async function mount(t, planRoute) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', '__planRoute'];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window,
    document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    __planRoute: planRoute,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const current = { navigation: null };
  function Probe() {
    current.navigation = useNavigation();
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Probe)));
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return current;
}

const place = (name, lng) => ({ name, coordinates: [lng, 30] });
const routeFor = (start, end, mode) => ({
  mode,
  geometryKind: 'road',
  coordinates: [start.coordinates, end.coordinates],
  distance: 1000,
  duration: 600,
  createdAt: Date.now(),
  snapped: [start.coordinates, end.coordinates],
  steps: [],
});

test('planTo reuses an explicit start, keeps via stops and current mode', async (t) => {
  const calls = [];
  const current = await mount(t, (...args) => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    calls.push({ args, resolve });
    return promise;
  });
  const origin = place('自定义起点', 104);
  const via = place('途经点', 104.01);
  const previousDestination = place('旧终点', 104.02);
  const destination = place('搜索目标', 104.03);
  const fallback = place('定位起点', 105);

  await React.act(async () => current.navigation.place('start', origin));
  await React.act(async () => current.navigation.add());
  await React.act(async () => current.navigation.place(1, via));
  await React.act(async () => current.navigation.place('end', previousDestination));
  await React.act(async () => current.navigation.setMode('bicycle'));

  let planned;
  await React.act(async () => { planned = current.navigation.planTo(destination, fallback); });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), [origin, destination, 'bicycle']);
  assert.deepEqual(calls[0].args[4], [via]);
  assert.equal(current.navigation.start, origin);
  assert.equal(current.navigation.end, destination);
  assert.equal(current.navigation.stops[1].place, via);
  assert.equal(current.navigation.mode, 'bicycle');

  await React.act(async () => {
    calls[0].resolve(routeFor(origin, destination, 'bicycle'));
    planned = await planned;
  });
  assert.equal(planned.mode, 'bicycle');
  assert.equal(current.navigation.route, planned);
});

test('planTo fills only an empty start from fallback and plans atomically', async (t) => {
  const calls = [];
  const current = await mount(t, (...args) => {
    calls.push(args);
    return Promise.resolve(routeFor(args[0], args[1], args[2]));
  });
  const fallback = place('真实定位', 104);
  const destination = place('搜索目标', 104.03);
  let planned;
  await React.act(async () => { planned = await current.navigation.planTo(destination, fallback); });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), [fallback, destination, 'auto']);
  assert.equal(current.navigation.start, fallback);
  assert.equal(current.navigation.end, destination);
  assert.equal(planned.name, '真实定位 → 搜索目标');
});

test('planTo with no start or an incomplete via point returns to editing without calling provider', async (t) => {
  let calls = 0;
  const current = await mount(t, () => { calls++; return Promise.resolve(null); });
  const destination = place('搜索目标', 104.03);

  let result;
  await React.act(async () => { result = await current.navigation.planTo(destination); });
  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.equal(current.navigation.error, '请等待准确定位或手动选择起点后再规划。');
  assert.equal(current.navigation.end, destination);

  await React.act(async () => current.navigation.place('start', place('自定义起点', 104)));
  await React.act(async () => current.navigation.add());
  await React.act(async () => { result = await current.navigation.planTo(destination); });
  assert.equal(result, null);
  assert.equal(calls, 0);
  assert.match(current.navigation.error, /途经点 1尚未选择地点/);
  assert.equal(current.navigation.stops[1].place, null);
});

test('a newer planTo aborts the old provider request and only applies the newest route', async (t) => {
  const calls = [];
  const current = await mount(t, (...args) => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    calls.push({ args, resolve });
    return promise;
  });
  const fallback = place('定位起点', 104);
  const firstDestination = place('第一个目标', 104.01);
  const secondDestination = place('第二个目标', 104.02);
  let first;
  let second;

  await React.act(async () => { first = current.navigation.planTo(firstDestination, fallback); });
  await React.act(async () => { second = current.navigation.planTo(secondDestination, fallback); });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[3].aborted, true);
  assert.equal(calls[1].args[3].aborted, false);

  await React.act(async () => {
    calls[0].resolve(routeFor(fallback, firstDestination, 'auto'));
    assert.equal(await first, null);
    calls[1].resolve(routeFor(fallback, secondDestination, 'auto'));
    second = await second;
  });
  assert.equal(second.coordinates.at(-1), secondDestination.coordinates);
  assert.equal(current.navigation.end, secondDestination);
  assert.equal(current.navigation.route.coordinates.at(-1), secondDestination.coordinates);
});
