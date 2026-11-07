import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { mkdir } from 'node:fs/promises';

test('restored route cancellation hides its saved copy, clears navigation, and never revives stale plans', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  await mkdir('.openai/planned-route-cancel', { recursive: true });
  const requests = [];
  globalThis.cancelPlanRequests = requests;
  await build({
    entryPoints: {
      useNavigation: 'modules/navigation/useNavigation.ts',
      useRouteFavorites: 'modules/navigation/useRouteFavorites.ts',
    },
    outdir: '.openai/planned-route-cancel',
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    plugins: [{
      name: 'planned-route-cancel-planner',
      setup(builder) {
        builder.onResolve({ filter: /(^|\/)provider$/ }, () => ({ path: 'planner', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: `export const planRoute=(start,end,mode,signal,via=[])=>new Promise((resolve,reject)=>globalThis.cancelPlanRequests.push({start,end,mode,signal,via,resolve,reject}));`,
        }));
      },
    }],
  });

  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { useNavigation } = await import('../.openai/planned-route-cancel/useNavigation.mjs');
  const { useRouteFavorites } = await import('../.openai/planned-route-cancel/useRouteFavorites.mjs');
  const disk = new Map();
  let failWrites = false;
  globalThis.localStorage = {
    getItem: key => disk.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error('storage unavailable');
      disk.set(key, value);
    },
  };

  const favoriteStorageKey = 'guanyun.route-favorites.v1';
  const placeStart = { name: '起点', coordinates: [104, 30] };
  const placeEnd = { name: '终点', coordinates: [104.04, 30.04] };
  const makeRoute = (createdAt, mode = 'auto', offset = 0) => ({
    name: `路线-${createdAt}`,
    mode,
    coordinates: [[104 + offset, 30], [104.02 + offset, 30.02], [104.04 + offset, 30.04]],
    distance: 5000,
    duration: 900,
    steps: [],
    snapped: [placeStart.coordinates, placeEnd.coordinates],
    createdAt,
    style: { color: '#234567', width: 2 },
  });
  const makeFavorite = (id, planned, visible = true) => ({
    id,
    name: `收藏-${id}`,
    savedAt: planned.createdAt + 1,
    start: placeStart,
    end: placeEnd,
    route: planned,
    visible,
  });
  const currentRoute = makeRoute(1_791_010_800_000);
  const matchingFavorite = makeFavorite('matching', currentRoute);
  const unrelatedRoute = makeRoute(1_791_010_800_100, 'bicycle', 1);
  const unrelatedFavorite = makeFavorite('unrelated', unrelatedRoute);
  const storeFavorites = value => disk.set(favoriteStorageKey, JSON.stringify(value));
  const reloadFavorites = async value => {
    storeFavorites(value);
    await act(async () => window.dispatchEvent(new window.Event('guanyun-data-changed')));
  };

  storeFavorites([matchingFavorite, unrelatedFavorite]);
  let state;
  function Probe() {
    state = { navigation: useNavigation(), favorites: useRouteFavorites() };
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Probe)));
  t.after(async () => {
    await act(async () => root.unmount());
    delete globalThis.cancelPlanRequests;
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  assert.equal(state.favorites.items.length, 2, 'favorites hydrate from isolated memory storage');
  await act(async () => {
    assert.equal(state.navigation.restore(matchingFavorite), true);
    state.navigation.setPicking('start');
  });
  const restoredRoute = state.navigation.route;
  assert.ok(restoredRoute);
  assert.deepEqual(state.navigation.start.coordinates, placeStart.coordinates);
  assert.deepEqual(state.navigation.end.coordinates, placeEnd.coordinates);

  let hidden = false;
  await act(async () => { hidden = state.favorites.hideRoute(restoredRoute); });
  assert.equal(hidden, true);
  assert.equal(JSON.parse(disk.get(favoriteStorageKey))[0].visible, false, 'hidden state persists before navigation clears');
  await act(async () => state.navigation.clear());
  assert.equal(state.navigation.route, null);
  assert.equal(state.navigation.start, null);
  assert.equal(state.navigation.end, null);
  assert.equal(state.navigation.picking, null);
  assert.equal(state.favorites.items.length, 2, 'cancel never deletes favorites');
  assert.equal(state.favorites.items[0].visible, false);
  assert.deepEqual(state.favorites.items[0].route, matchingFavorite.route, 'saved route geometry and style remain intact');
  assert.equal(state.favorites.items[1].visible, true, 'unrelated favorite remains visible');

  const staleRoute = makeRoute(1_791_010_801_000);
  const staleFavorite = makeFavorite('stale-plan', staleRoute);
  await reloadFavorites([staleFavorite, unrelatedFavorite]);
  await act(async () => { state.navigation.restore(staleFavorite); });
  await act(async () => state.navigation.setMode('bicycle'));
  assert.equal(requests.length, 1, 'mode change starts a fresh pending route plan');
  assert.equal(requests[0].mode, 'bicycle');
  let staleHidden = false;
  await act(async () => { staleHidden = state.favorites.hideRoute(state.navigation.route); });
  assert.equal(staleHidden, true);
  await act(async () => state.navigation.clear());
  assert.equal(requests[0].signal.aborted, true);
  const oldPlan = makeRoute(staleRoute.createdAt + 1, 'bicycle');
  await act(async () => requests[0].resolve(oldPlan));
  assert.equal(state.navigation.route, null, 'a late plan cannot revive a cancelled route');
  assert.equal(state.navigation.start, null);
  assert.equal(state.navigation.end, null);
  assert.equal(state.navigation.picking, null);
  assert.equal(state.favorites.items.length, 2);
  assert.equal(state.favorites.items[0].visible, false);
  assert.equal(state.favorites.items[1].visible, true);

  const failureRoute = makeRoute(1_791_010_802_000);
  const failureFavorite = makeFavorite('storage-failure', failureRoute);
  await reloadFavorites([failureFavorite, unrelatedFavorite]);
  await act(async () => {
    state.navigation.clear();
    state.navigation.restore(failureFavorite);
  });
  failWrites = true;
  let saved = true;
  await act(async () => { saved = state.favorites.hideRoute(state.navigation.route); });
  assert.equal(saved, false, 'storage failure is not reported as successful cancellation visibility update');
  assert.equal(state.favorites.items[0].visible, true, 'in-memory favorite is not falsely marked hidden');
  assert.equal(JSON.parse(disk.get(favoriteStorageKey))[0].visible, true, 'stored favorite remains visible after rejected write');
  assert.equal(state.favorites.message, '路线显示状态未保存。');
  assert.ok(state.navigation.route, 'the active route remains available when hiding its saved copy fails');
});
