import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { pathToFileURL } from 'node:url';

const output = '.openai/search-quick-navigation-hook/hook-test.mjs';
await build({
  entryPoints: ['modules/navigation/useSearchQuickNavigation.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
});

const { useSearchQuickNavigation } = await import(`${pathToFileURL(`${process.cwd()}/${output}`).href}?test=${Date.now()}`);
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const place = (name, lng) => ({ name, coordinates: [lng, 30] });
const gpsFix = (overrides = {}) => ({
  coordinates: [104, 30],
  accuracy: 12,
  timestamp: Date.now(),
  source: 'gps',
  ...overrides,
});

async function mount(t, { fix = null, active = false, panelOpen = true } = {}) {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({
    window,
    document,
    navigator: window.navigator,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });

  const state = { start: null, end: null, mode: 'bicycle', via: [place('已有途经点', 104.1)] };
  const calls = { place: [], plan: [], locate: 0 };
  let setProps;
  let forceRender;
  const current = {};
  function Probe() {
    const [props, updateProps] = React.useState({ fix, active, panelOpen });
    const [, refresh] = React.useState(0);
    setProps = (change) => updateProps((previousProps) => ({ ...previousProps, ...change }));
    forceRender = () => refresh((value) => value + 1);
    const navigation = {
      start: state.start,
      end: state.end,
      mode: state.mode,
      via: state.via,
      place: (slot, destination) => {
        calls.place.push({ slot, destination });
        if (slot === 'start') state.start = destination;
        if (slot === 'end') state.end = destination;
        forceRender();
      },
      planTo: (destination, fallbackStart, onApplied) => {
        calls.plan.push({ destination, fallbackStart, mode: state.mode, via: [...state.via], onApplied });
        return Promise.resolve(null);
      },
    };
    current.navigation = navigation;
    current.quick = useSearchQuickNavigation({
      navigation,
      fix: props.fix,
      active: props.active,
      panelOpen: props.panelOpen,
      locate: () => { calls.locate++; },
      onRouteApplied: (route) => { current.applied = route; },
    });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Probe)));
  current.setProps = async (change) => React.act(async () => setProps(change));
  current.setStart = async (start) => React.act(async () => { state.start = start; forceRender(); });
  current.calls = calls;
  current.state = state;
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return current;
}

test('fresh GPS starts the search route immediately and planTo preserves current mode and vias', async (t) => {
  const current = await mount(t, { fix: gpsFix() });
  const destination = place('搜索目的地', 104.2);
  let handled;
  await React.act(async () => { handled = current.quick.begin(destination); });

  assert.equal(handled, true);
  assert.equal(current.calls.plan.length, 1);
  assert.equal(current.calls.plan[0].destination, destination);
  assert.deepEqual(current.calls.plan[0].fallbackStart, { name: '当前位置', coordinates: [104, 30] });
  assert.equal(current.calls.plan[0].mode, 'bicycle');
  assert.deepEqual(current.calls.plan[0].via, [place('已有途经点', 104.1)]);
  assert.equal(current.calls.place.length, 0);
  assert.equal(current.calls.locate, 0);
  assert.equal(current.quick.waitingForPosition, false);
});

test('network, IP, stale, and inaccurate fixes wait for a later fresh GPS fix', async (t) => {
  const invalidFixes = [
    gpsFix({ source: 'network' }),
    gpsFix({ provider: 'ip' }),
    gpsFix({ timestamp: Date.now() - 30_000 }),
    gpsFix({ accuracy: 51 }),
  ];
  const current = await mount(t, { fix: invalidFixes[0] });
  const destination = place('搜索目的地', 104.2);
  await React.act(async () => current.quick.begin(destination));
  assert.equal(current.calls.plan.length, 0);
  assert.deepEqual(current.calls.place.map((entry) => entry.slot), ['end']);
  assert.equal(current.calls.locate, 1);
  assert.equal(current.quick.waitingForPosition, true);

  for (const invalidFix of invalidFixes.slice(1)) {
    await current.setProps({ fix: invalidFix });
    assert.equal(current.calls.plan.length, 0);
    assert.equal(current.quick.waitingForPosition, true);
  }
  await current.setProps({ fix: gpsFix() });
  assert.equal(current.calls.plan.length, 1);
  assert.deepEqual(current.calls.plan[0].fallbackStart, { name: '当前位置', coordinates: [104, 30] });
  assert.equal(current.quick.waitingForPosition, false);
});

test('a manually selected start completes the pending destination without replacing the start', async (t) => {
  const current = await mount(t);
  const destination = place('搜索目的地', 104.2);
  const start = place('手动起点', 103.9);
  await React.act(async () => current.quick.begin(destination));
  assert.equal(current.quick.waitingForPosition, true);

  await current.setStart(start);
  assert.equal(current.calls.plan.length, 1);
  assert.equal(current.calls.plan[0].destination, destination);
  assert.equal(current.calls.plan[0].fallbackStart, undefined);
  assert.equal(current.state.start, start);
  assert.equal(current.quick.waitingForPosition, false);
});

test('closing the panel cancels pending search navigation so a late fix cannot revive it', async (t) => {
  const current = await mount(t);
  const destination = place('已取消目的地', 104.2);
  await React.act(async () => current.quick.begin(destination));
  await current.setProps({ panelOpen: false });
  assert.equal(current.quick.waitingForPosition, false);

  await current.setProps({ panelOpen: true, fix: gpsFix() });
  assert.equal(current.calls.plan.length, 0);
  assert.equal(current.state.end, destination);
});

test('the latest repeated search destination wins while waiting for location', async (t) => {
  const current = await mount(t);
  const first = place('较早结果', 104.2);
  const latest = place('最新结果', 104.3);
  await React.act(async () => current.quick.begin(first));
  await React.act(async () => current.quick.begin(latest));
  assert.equal(current.state.end, latest);

  await current.setProps({ fix: gpsFix() });
  assert.equal(current.calls.plan.length, 1);
  assert.equal(current.calls.plan[0].destination, latest);
  assert.equal(current.quick.waitingForPosition, false);
});

test('active navigation declines quick navigation without changing route inputs', async (t) => {
  const current = await mount(t, { active: true });
  const destination = place('搜索目的地', 104.2);
  let handled;
  await React.act(async () => { handled = current.quick.begin(destination); });
  assert.equal(handled, false);
  assert.equal(current.calls.place.length, 0);
  assert.equal(current.calls.plan.length, 0);
  assert.equal(current.calls.locate, 0);
  assert.equal(current.state.end, null);
});
