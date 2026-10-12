import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

function longPlace(name, detail, index = 0) {
  return {
    name,
    detail,
    coordinates: [104 + index / 100, 30 + index / 100],
    precision: 'unknown',
    source: 'tianditu',
  };
}

test('PlaceSearch renders real filter, result detail, share, count, and load-more interactions', async (t) => {
  const { window } = (await import('linkedom')).parseHTML(
    '<html><body><div id="root"></div></body></html>',
  );
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const longName = 'Exact community name '.repeat(10).trim();
  const longAddress = 'District · Long avenue · Building 12 · Unit 3 '.repeat(8).trim();
  globalThis.__searchUiSnapshot = {
    source: 'tianditu', city: '武汉市', nationwide: true,
    setSource(value) { globalThis.__filterChanges.push(['source', value]); },
    setCity(value) { globalThis.__filterChanges.push(['city', value]); },
    setNationwide(value) { globalThis.__filterChanges.push(['nationwide', value]); },
    places: [longPlace(longName, longAddress), ...Array.from({ length: 10 }, (_, i) =>
      longPlace(`Place ${i + 2}`, `Address ${i + 2}`, i + 1))],
    suggestions: [], warnings: [], error: '', busy: false,
    next: { provider: 'tianditu', query: longName, start: 20 },
    loadMore() { globalThis.__loadMoreCalls++; }, searchNow() { globalThis.__searchCalls++; }, resetOptions() {},
  };
  globalThis.__filterChanges = [];
  globalThis.__loadMoreCalls = 0;
  globalThis.__searchCalls = 0;
  globalThis.__shareCalls = [];

  await build({
    entryPoints: ['modules/controls/PlaceSearch.tsx'],
    outdir: '.openai/place-search-ui-test',
    entryNames: 'PlaceSearch',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'place-search-test-doubles',
      setup(buildApi) {
        const stubs = new Map([
          ['../uiLayout/events', 'export const isLayoutInteraction = () => false;'],
          ['../input/FloatingSearch', 'export function FloatingSearch(props) { globalThis.__floatingProps = props; return props.children; }'],
          ['../platform/desktop', 'export const isDesktopShell = () => false;'],
          ['../navigation/PlaceName', 'export const useMapPlaceLabel = () => ({ title: "" });'],
          ['../navigation/usePlaceSearch', `export function usePlaceSearch(args) {
            globalThis.__searchUiHookArgs = args;
            return globalThis.__searchUiSnapshot;
          }`],
        ]);
        buildApi.onResolve({ filter: /^(\.\.\/uiLayout\/events|\.\.\/input\/FloatingSearch|\.\.\/platform\/desktop|\.\.\/navigation\/(PlaceName|usePlaceSearch))$/ }, (args) => ({
          path: args.path, namespace: 'place-search-test-double',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'place-search-test-double' }, (args) => ({
          contents: stubs.get(args.path), loader: 'ts',
        }));
      },
    }],
  });

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PlaceSearch } = await import('../.openai/place-search-ui-test/PlaceSearch.js');
  const root = createRoot(document.getElementById('root'));
  const props = {
    center: [104, 30], zoom: 12, onOpen() {}, onSelect() {},
    onShare(place) { globalThis.__shareCalls.push(place); },
  };
  const render = () => React.createElement(PlaceSearch, props);
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const key of ['__searchUiSnapshot', '__searchUiHookArgs', '__filterChanges', '__loadMoreCalls', '__searchCalls', '__shareCalls', '__floatingProps', 'IS_REACT_ACT_ENVIRONMENT', 'window', 'document'])
      delete globalThis[key];
  });

  await React.act(async () => root.render(render()));
  const input = document.querySelector('input[type="search"]');
  assert.ok(input, 'search field is mounted');
  await React.act(async () => input.click());
  const dialog = document.querySelector('dialog.place-search-results');
  assert.ok(dialog, 'search results open from the actual search field');

  const expandList = dialog.querySelector('.place-search-expand-toggle');
  assert.ok(expandList);
  assert.equal(expandList.getAttribute('aria-label'), '\u5c55\u5f00\u5217\u8868');
  assert.equal(expandList.getAttribute('aria-expanded'), 'false');
  assert.equal(globalThis.__floatingProps.maxHeight, 205);
  const initialSearchCalls = globalThis.__searchCalls;
  await React.act(async () => expandList.click());
  assert.equal(expandList.getAttribute('aria-label'), '\u6536\u8d77\u5217\u8868');
  assert.equal(expandList.getAttribute('aria-expanded'), 'true');
  assert.equal(globalThis.__floatingProps.maxHeight, 340);
  assert.equal(globalThis.__floatingProps.expandToViewport, true);
  assert.equal(globalThis.__searchCalls, initialSearchCalls, 'expanding the list does not launch a search');
  assert.equal(globalThis.__loadMoreCalls, 0, 'expanding the list does not load another page');
  await React.act(async () => expandList.click());
  assert.equal(expandList.getAttribute('aria-expanded'), 'false');
  assert.equal(globalThis.__floatingProps.maxHeight, 205);
  assert.equal(globalThis.__floatingProps.expandToViewport, false);
  assert.equal(globalThis.__searchCalls, initialSearchCalls);
  assert.equal(globalThis.__loadMoreCalls, 0);

  const filterToggle = dialog.querySelector('.place-search-filter-toggle');
  assert.ok(filterToggle);
  assert.equal(filterToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(dialog.querySelector('select'), null, 'filters start collapsed');
  await React.act(async () => filterToggle.click());
  assert.equal(filterToggle.getAttribute('aria-expanded'), 'true');
  const sourceSelect = dialog.querySelector('select');
  assert.equal(sourceSelect.value, 'tianditu');
  assert.equal(dialog.querySelector('input[type="checkbox"]').checked, true);
  assert.equal(dialog.querySelector('.place-search-city input').value, '武汉市');
  await React.act(async () => filterToggle.click());
  assert.equal(dialog.querySelector('select'), null);
  assert.deepEqual(globalThis.__filterChanges, [], 'opening and closing filters does not invoke option change handlers');
  await React.act(async () => filterToggle.click());
  assert.equal(dialog.querySelector('select').value, 'tianditu', 'source remains selected after reopening');
  assert.equal(dialog.querySelector('input[type="checkbox"]').checked, true, 'nationwide setting remains selected after reopening');
  assert.equal(dialog.querySelector('.place-search-city input').value, '武汉市', 'city remains selected after reopening');

  await React.act(async () => dialog.querySelector('.place-search-expand-toggle').click());
  await React.act(async () => [...dialog.querySelectorAll('.place-search-heading-actions > button')].at(-1).click());
  assert.equal(document.querySelector('dialog.place-search-results'), null, 'closing the search dismisses the dialog');
  await React.act(async () => input.click());
  const reopenedDialog = document.querySelector('dialog.place-search-results');
  assert.ok(reopenedDialog);
  assert.equal(reopenedDialog.querySelector('.place-search-expand-toggle').getAttribute('aria-expanded'), 'false',
    'reopening resets the list to compact mode');
  assert.equal(globalThis.__floatingProps.maxHeight, 205);
  await React.act(async () => reopenedDialog.querySelector('.place-search-filter-toggle').click());
  assert.equal(reopenedDialog.querySelector('select').value, 'tianditu', 'closing and reopening preserves source');
  assert.equal(reopenedDialog.querySelector('input[type="checkbox"]').checked, true, 'closing and reopening preserves nationwide');
  assert.equal(reopenedDialog.querySelector('.place-search-city input').value, globalThis.__searchUiSnapshot.city, 'closing and reopening preserves city');
  assert.equal(reopenedDialog.querySelectorAll('[data-place-result]').length, 11, 'closing and reopening preserves loaded results');
  assert.equal(globalThis.__searchCalls, initialSearchCalls, 'the expansion and close/reopen cycle does not call search');
  assert.equal(globalThis.__loadMoreCalls, 0, 'the expansion and close/reopen cycle does not call load-more');

  const heading = reopenedDialog.querySelector('.place-search-heading-title');
  assert.match(heading.textContent, /11/);
  const footer = reopenedDialog.querySelector('.place-search-footer');
  assert.ok(footer);
  assert.match(footer.textContent, /11/);
  assert.equal(reopenedDialog.querySelector('.place-search-options').contains(footer), false,
    'loaded count and paging controls remain outside the scrollable results region');
  const more = footer.querySelector('.place-search-more');
  assert.ok(more, 'next-page action is reachable in the fixed footer');
  assert.equal(more.disabled, false);
  await React.act(async () => more.click());
  assert.equal(globalThis.__loadMoreCalls, 1);

  globalThis.__searchUiSnapshot = { ...globalThis.__searchUiSnapshot, busy: true };
  await React.act(async () => root.render(render()));
  const busyMore = document.querySelector('.place-search-footer .place-search-more');
  assert.equal(busyMore.disabled, true, 'load-more action is disabled while a page is loading');
  await React.act(async () => busyMore.click());
  assert.equal(globalThis.__loadMoreCalls, 1, 'disabled busy action cannot enqueue another page');
  globalThis.__searchUiSnapshot = { ...globalThis.__searchUiSnapshot, busy: false };
  await React.act(async () => root.render(render()));

  const detailToggles = [...document.querySelectorAll('.place-result-details-toggle')];
  assert.equal(detailToggles.length, 11);
  await React.act(async () => detailToggles[0].click());
  assert.equal(detailToggles[0].getAttribute('aria-expanded'), 'true');
  let expanded = document.getElementById(detailToggles[0].getAttribute('aria-controls'));
  assert.ok(expanded.textContent.includes(longName), 'expanded details retain the complete long place name');
  assert.ok(expanded.textContent.includes(longAddress), 'expanded details retain the complete long address');
  assert.ok(expanded.textContent.includes('unknown') || expanded.textContent.includes('未知'),
    'expanded details disclose unknown precision');
  await React.act(async () => detailToggles[1].click());
  assert.equal(detailToggles[0].getAttribute('aria-expanded'), 'false', 'only one place detail is expanded at a time');
  assert.equal(detailToggles[1].getAttribute('aria-expanded'), 'true');
  const share = document.querySelector('.place-result-expanded .place-search-share');
  assert.ok(share, 'place-search entry preserves sharing inside expanded details');
  await React.act(async () => share.click());
  assert.equal(globalThis.__shareCalls.length, 1);
  assert.equal(globalThis.__shareCalls[0].name, 'Place 2');
});

test('RoutePanel keeps route search options stable while filters collapse and footer paging stays available', async (t) => {
  const { window } = (await import('linkedom')).parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.__searchUiHookArgs = [];
  globalThis.__filterChanges = [];
  globalThis.__loadMoreCalls = 0;
  globalThis.__searchUiSnapshot = {
    source: 'photon', city: 'Southport', nationwide: false,
    setSource(value) { globalThis.__filterChanges.push(['source', value]); },
    setCity(value) { globalThis.__filterChanges.push(['city', value]); },
    setNationwide(value) { globalThis.__filterChanges.push(['nationwide', value]); },
    places: Array.from({ length: 7 }, (_, i) => longPlace(`Route result ${i + 1}`, `Route address ${i + 1}`, i)),
    suggestions: [], warnings: [], error: '', busy: false,
    next: { provider: 'photon', query: 'Harbor', start: 20 },
    loadMore() { globalThis.__loadMoreCalls++; }, searchNow() { globalThis.__searchCalls++; }, resetOptions() {},
  };
  globalThis.__searchCalls = 0;

  await build({
    entryPoints: ['modules/navigation/RoutePanel.tsx'],
    outdir: '.openai/route-search-ui-test',
    entryNames: 'RoutePanel', bundle: true, format: 'esm', platform: 'node',
    packages: 'external', loader: { '.css': 'empty' },
    plugins: [{
      name: 'route-search-test-doubles',
      setup(buildApi) {
        const stubs = new Map([
          ['./RouteProviderNote', 'export function RouteProviderNote() { return null; }'],
          ['./RouteResultSummary', 'export function RouteResultSummary() { return null; }'],
          ['../input/FloatingSearch', 'export function FloatingSearch(props) { globalThis.__floatingProps = props; return props.children; }'],
          ['./usePlaceSearch', `export function usePlaceSearch(args) {
            globalThis.__searchUiHookArgs.push(args);
            return globalThis.__searchUiSnapshot;
          }`],
        ]);
        buildApi.onResolve({ filter: /^(\.\/RouteProviderNote|\.\/RouteResultSummary|\.\.\/input\/FloatingSearch|\.\/usePlaceSearch)$/ }, (args) => ({
          path: args.path, namespace: 'route-search-test-double',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'route-search-test-double' }, (args) => ({
          contents: stubs.get(args.path), loader: 'ts',
        }));
      },
    }],
  });

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { RoutePanel } = await import('../.openai/route-search-ui-test/RoutePanel.js');
  const root = createRoot(document.getElementById('root'));
  const navigation = {
    route: null, start: null, end: null, mode: 'car', loading: false, error: '', picking: null,
    stops: [
      { id: 'start', query: 'Harbor', place: null },
      { id: 'end', query: '', place: null },
    ],
    edit() {}, setPicking() {}, reorder() {}, remove() {}, setMode() {}, swap() {}, clear() {},
    add() {}, calculate: async () => null,
  };
  const props = {
    navigation, near: [104, 30], onPick() {}, onPlace() {}, onShow() {}, onSave() {},
    saveMessage: '', onCurrentPosition() {}, locating: false, onStartNavigation() {},
    navigating: false, guidanceError: '', onShare() {},
  };
  const render = () => React.createElement(RoutePanel, props);
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const key of ['__searchUiSnapshot', '__searchUiHookArgs', '__filterChanges', '__loadMoreCalls', '__searchCalls', '__floatingProps', 'IS_REACT_ACT_ENVIRONMENT', 'window', 'document'])
      delete globalThis[key];
  });

  await React.act(async () => root.render(render()));
  const input = document.querySelector('[data-stop-id="start"] input');
  assert.ok(input);
  await React.act(async () => input.dispatchEvent(new window.Event('focusin', { bubbles: true })));
  const dialog = document.querySelector('dialog.route-place-results');
  assert.ok(dialog, 'focusing the route stop opens its actual search dialog');
  assert.ok(globalThis.__searchUiHookArgs.some((args) => args.query === 'Harbor' && args.enabled));
  const expandList = dialog.querySelector('.place-search-expand-toggle');
  assert.ok(expandList);
  assert.equal(expandList.getAttribute('aria-label'), '\u5c55\u5f00\u5217\u8868');
  assert.equal(expandList.getAttribute('aria-expanded'), 'false');
  assert.equal(globalThis.__floatingProps.maxHeight, 205);
  const initialSearchCalls = globalThis.__searchCalls;
  await React.act(async () => expandList.click());
  assert.equal(expandList.getAttribute('aria-label'), '\u6536\u8d77\u5217\u8868');
  assert.equal(expandList.getAttribute('aria-expanded'), 'true');
  assert.equal(globalThis.__floatingProps.maxHeight, 340);
  assert.equal(globalThis.__floatingProps.expandToViewport, true);
  assert.equal(globalThis.__searchCalls, initialSearchCalls, 'expanding the route list does not launch search');
  assert.equal(globalThis.__loadMoreCalls, 0, 'expanding the route list does not load another page');
  await React.act(async () => expandList.click());
  assert.equal(expandList.getAttribute('aria-expanded'), 'false');
  assert.equal(globalThis.__floatingProps.maxHeight, 205);
  assert.equal(globalThis.__searchCalls, initialSearchCalls);
  assert.equal(globalThis.__loadMoreCalls, 0);
  const filterToggle = dialog.querySelector('.place-search-filter-toggle');
  assert.ok(filterToggle);
  assert.equal(filterToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(dialog.querySelector('select'), null);
  await React.act(async () => filterToggle.click());
  assert.equal(dialog.querySelector('select').value, 'photon');
  assert.equal(dialog.querySelector('.place-search-city input').value, 'Southport');
  assert.equal(dialog.querySelector('input[type="checkbox"]').checked, false);
  await React.act(async () => filterToggle.click());
  assert.deepEqual(globalThis.__filterChanges, [], 'collapsing route filters does not call option handlers');
  await React.act(async () => filterToggle.click());
  assert.equal(dialog.querySelector('select').value, 'photon');
  assert.equal(dialog.querySelector('.place-search-city input').value, 'Southport');
  assert.equal(dialog.querySelector('input[type="checkbox"]').checked, false);

  const footer = dialog.querySelector('.place-search-footer');
  assert.ok(footer);
  assert.match(footer.textContent, /7/);
  assert.equal(dialog.querySelector('.place-search-options').contains(footer), false,
    'route count and paging actions remain outside the scrollable result region');
  const more = footer.querySelector('.place-search-more');
  assert.ok(more);
  await React.act(async () => more.click());
  assert.equal(globalThis.__loadMoreCalls, 1);
  globalThis.__searchUiSnapshot = { ...globalThis.__searchUiSnapshot, busy: true };
  await React.act(async () => root.render(render()));
  assert.equal(document.querySelector('.place-search-footer .place-search-more').disabled, true);
  await React.act(async () => document.querySelector('.place-search-footer .place-search-more').click());
  assert.equal(globalThis.__loadMoreCalls, 1);

  await React.act(async () => dialog.querySelector('.place-search-expand-toggle').click());
  await React.act(async () => [...dialog.querySelectorAll('.place-search-heading-actions > button')].at(-1).click());
  assert.equal(document.querySelector('dialog.route-place-results'), null, 'closing route search dismisses its dialog');
  await React.act(async () => input.dispatchEvent(new window.Event('focusin', { bubbles: true })));
  const reopenedDialog = document.querySelector('dialog.route-place-results');
  assert.ok(reopenedDialog);
  assert.equal(reopenedDialog.querySelector('.place-search-expand-toggle').getAttribute('aria-expanded'), 'false',
    'reopening route search resets list expansion');
   assert.equal(globalThis.__floatingProps.maxHeight, 205);
  await React.act(async () => reopenedDialog.querySelector('.place-search-filter-toggle').click());
  assert.equal(reopenedDialog.querySelector('select').value, 'photon', 'route source persists after close/reopen');
  assert.equal(reopenedDialog.querySelector('.place-search-city input').value, globalThis.__searchUiSnapshot.city);
  assert.equal(reopenedDialog.querySelector('input[type="checkbox"]').checked, false);
  assert.equal(reopenedDialog.querySelectorAll('[data-place-result]').length, 7, 'route results persist after close/reopen');
  assert.equal(globalThis.__searchCalls, initialSearchCalls, 'route expansion and close/reopen do not launch search');
  assert.equal(globalThis.__loadMoreCalls, 1, 'route expansion and close/reopen do not add a load-more call');
});
