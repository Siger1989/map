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
  globalThis.__selectCalls = [];
  globalThis.__navigateEvents = [];
  globalThis.__interactionOrder = [];
  globalThis.__searchHistoryEntries = ['Saved Search A', 'Saved Search B'];
  globalThis.__historyEvents = [];
  globalThis.__searchUiHookArgs = [];

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
        buildApi.onResolve({ filter: /^react$/ }, () => ({ path: 'react', external: true }));
        const stubs = new Map([
          ['../uiLayout/events', 'export const isLayoutInteraction = () => false;'],
          ['../input/FloatingSearch', 'export function FloatingSearch(props) { globalThis.__floatingProps = props; return props.children; }'],
          ['../platform/desktop', 'export const isDesktopShell = () => false;'],
          ['../navigation/PlaceName', 'export const useMapPlaceLabel = () => ({ title: "" });'],
          ['../navigation/usePlaceSearch', `export function usePlaceSearch(args) {
            if (globalThis.__searchUiHookArgs.length >= 200) throw new Error('Unexpected search render loop: ' + JSON.stringify(args));
            globalThis.__searchUiHookArgs.push(args);
            return globalThis.__searchUiSnapshot;
          }`],
          ['../navigation/useSearchHistory', `import { useState } from 'react';
            export function useSearchHistory() {
              const [entries, setEntries] = useState(globalThis.__searchHistoryEntries);
              return {
                entries,
                record(query) {
                  globalThis.__historyEvents.push(['record', query]);
                  setEntries((current) => [query, ...current.filter((entry) => entry !== query)]);
                },
                remove(query) {
                  globalThis.__historyEvents.push(['remove', query]);
                  setEntries((current) => current.filter((entry) => entry !== query));
                },
                clear() {
                  globalThis.__historyEvents.push(['clear']);
                  setEntries([]);
                },
              };
            }`],
        ]);
        buildApi.onResolve({ filter: /^(\.\.\/uiLayout\/events|\.\.\/input\/FloatingSearch|\.\.\/platform\/desktop|\.\.\/navigation\/(PlaceName|usePlaceSearch|useSearchHistory))$/ }, (args) => ({
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
    center: [104, 30], zoom: 12, onOpen() {},
    onSelect(place) { globalThis.__selectCalls.push(place); },
    onNavigate(place) { globalThis.__navigateEvents.push(['navigate', place]); globalThis.__interactionOrder.push('navigate'); },
    onShare(place) { globalThis.__shareCalls.push(place); },
  };
  const render = () => React.createElement(PlaceSearch, props);
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const key of ['__searchUiSnapshot', '__searchUiHookArgs', '__filterChanges', '__loadMoreCalls', '__searchCalls', '__shareCalls', '__selectCalls', '__navigateEvents', '__interactionOrder', '__blurEvents', '__floatingProps', '__searchHistoryEntries', '__historyEvents', 'IS_REACT_ACT_ENVIRONMENT', 'window', 'document'])
      delete globalThis[key];
  });

  await React.act(async () => root.render(render()));
  const input = document.querySelector('input[type="search"]');
  assert.ok(input, 'search field is mounted');
  const reactProps = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))];
  const setQueryThroughInput = async (value) => React.act(async () => reactProps(input).onChange({ target: { value } }));
  const submitCurrentQuery = async () => React.act(async () => reactProps(document.querySelector('.place-search form')).onSubmit({ preventDefault() {} }));
  await React.act(async () => input.click());
  let dialog = document.querySelector('dialog.place-search-results');
  assert.ok(dialog, 'search results open from the actual search field');
  assert.ok(dialog.querySelector('.place-search-history'), 'empty input shows recent searches');
  assert.equal(globalThis.__floatingProps.maxHeight, 148, 'history sizing follows its visible entry count');
  assert.equal(dialog.querySelector('.place-search-expand-toggle'), null, 'history does not show result-list controls');
  const restoreSaved = dialog.querySelector('[aria-label="重新搜索：Saved Search A"]');
  assert.ok(restoreSaved);
  await React.act(async () => restoreSaved.click());
  assert.equal(input.value, 'Saved Search A', 'history restores the saved query');
  assert.equal(globalThis.__selectCalls.length, 0, 'history restore does not select a place');
  assert.equal(globalThis.__navigateEvents.length, 0, 'history restore does not navigate');
  await setQueryThroughInput('Harbor');
  assert.equal(input.value, 'Harbor');
  await submitCurrentQuery();
  assert.ok(globalThis.__historyEvents.some(([action, query]) => action === 'record' && query === 'Harbor'),
    'explicit search submission records the query');
  await setQueryThroughInput('A');
  await submitCurrentQuery();
  assert.equal(globalThis.__historyEvents.some(([action, query]) => action === 'record' && query === 'A'), false,
    'single-character queries are not recorded');
  await setQueryThroughInput('Harbor');
  globalThis.__searchUiSnapshot = { ...globalThis.__searchUiSnapshot, suggestions: [{ query: 'Suggestion Town', label: 'Suggestion Town', city: '武汉市' }] };
  await React.act(async () => root.render(render()));
  const suggestion = document.querySelector('.place-search-suggestions button');
  assert.ok(suggestion);
  await React.act(async () => suggestion.click());
  assert.equal(input.value, 'Suggestion Town');
  assert.ok(globalThis.__historyEvents.some(([action, query]) => action === 'record' && query === 'Suggestion Town'),
    'choosing a suggestion records its query');
  assert.equal(globalThis.__selectCalls.length, 0, 'choosing a suggestion does not select a map place');
  assert.equal(globalThis.__navigateEvents.length, 0, 'choosing a suggestion does not navigate');
  await setQueryThroughInput('Harbor');
  await submitCurrentQuery();
  globalThis.__searchUiSnapshot = { ...globalThis.__searchUiSnapshot, suggestions: [] };
  globalThis.__filterChanges = [];
  await React.act(async () => root.render(render()));
  dialog = document.querySelector('dialog.place-search-results');

  const expandList = dialog.querySelector('.place-search-expand-toggle');
  assert.ok(expandList);
  assert.equal(expandList.getAttribute('aria-label'), '\u5c55\u5f00\u5217\u8868');
  assert.equal(expandList.getAttribute('aria-expanded'), 'false');
  assert.equal(globalThis.__floatingProps.maxHeight, 340);
  const firstDistance = dialog.querySelector('.place-result-distance');
  assert.ok(firstDistance, 'place results show distance in its own field');
  assert.match(firstDistance.textContent, /^距地图中心\s*\S+/);
  assert.equal(firstDistance.textContent.includes('…'), false, 'distance text is complete rather than ellipsized');
  const initialSearchCalls = globalThis.__searchCalls;
  await React.act(async () => expandList.click());
  assert.equal(expandList.getAttribute('aria-label'), '\u6536\u8d77\u5217\u8868');
  assert.equal(expandList.getAttribute('aria-expanded'), 'true');
  assert.equal(globalThis.__floatingProps.maxHeight, 450);
  assert.equal(globalThis.__floatingProps.expandToViewport, true);
  assert.equal(globalThis.__searchCalls, initialSearchCalls, 'expanding the list does not launch a search');
  assert.equal(globalThis.__loadMoreCalls, 0, 'expanding the list does not load another page');
  await React.act(async () => expandList.click());
  assert.equal(expandList.getAttribute('aria-expanded'), 'false');
  assert.equal(globalThis.__floatingProps.maxHeight, 340);
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
  assert.equal(globalThis.__floatingProps.maxHeight, 340);
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

  await React.act(async () => input.click());
  const navigateDialog = document.querySelector('dialog.place-search-results');
  assert.equal(globalThis.__floatingProps.maxHeight, 340, 'place search starts in compact mode');
  await React.act(async () => navigateDialog.querySelector('.place-search-filter-toggle').click());
  const navigateDetails = navigateDialog.querySelectorAll('.place-result-details-toggle')[0];
  const searchCallsBeforeDetail = globalThis.__searchCalls;
  const loadMoreCallsBeforeDetail = globalThis.__loadMoreCalls;
  await React.act(async () => navigateDetails.click());
  assert.equal(globalThis.__floatingProps.maxHeight, 450, 'expanding place details makes the full action visible');
  assert.equal(navigateDialog.querySelector('.place-search-expand-toggle').getAttribute('aria-expanded'), 'true',
    'detail expansion synchronizes the list toggle');
  await React.act(async () => navigateDetails.click());
  assert.equal(navigateDetails.getAttribute('aria-expanded'), 'false', 'details can be collapsed');
  assert.equal(globalThis.__floatingProps.maxHeight, 450, 'collapsing details does not collapse the result layer');
  assert.equal(globalThis.__searchCalls, searchCallsBeforeDetail, 'detail toggles do not launch searches');
  assert.equal(globalThis.__loadMoreCalls, loadMoreCallsBeforeDetail, 'detail toggles do not load another page');
  await React.act(async () => navigateDetails.click());
  const goHere = navigateDialog.querySelector('.place-search-go');
  assert.ok(goHere, 'expanded place-search details offer direct route planning');
  assert.equal(goHere.getAttribute('aria-label'), `\u53bb\u8fd9\u91cc\uff1a${longName}`);
  assert.equal(navigateDetails.getAttribute('aria-expanded'), 'true', 'route action is only shown inside expanded details');
  assert.equal(navigateDialog.querySelector('.place-search-options').contains(goHere), true,
    'expanded route action remains inside the scrollable results content');
  assert.ok(navigateDialog.querySelector('.place-search-share'), 'sharing remains available alongside route planning');
  const navigatePlace = globalThis.__searchUiSnapshot.places[0];
  const originalBlur = input.blur.bind(input);
  globalThis.__blurEvents = [];
  input.blur = () => { globalThis.__blurEvents.push('blur'); globalThis.__interactionOrder.push('blur'); originalBlur(); };
  await React.act(async () => goHere.click());
  assert.deepEqual(globalThis.__blurEvents, ['blur']);
  assert.equal(globalThis.__navigateEvents.length, 1);
  assert.deepEqual(globalThis.__navigateEvents[0], ['navigate', navigatePlace], 'the complete RoutePlace object reaches the navigation callback');
  assert.strictEqual(globalThis.__navigateEvents[0][1], navigatePlace, 'navigation receives the original RoutePlace object');
  assert.deepEqual(globalThis.__interactionOrder, ['blur', 'navigate'], 'search input blurs before route callback');
  assert.equal(globalThis.__selectCalls.length, 0, 'direct route planning does not also select and jump the map');
  assert.equal(document.querySelector('dialog.place-search-results'), null, 'route planning closes the search');

  await React.act(async () => input.click());
  const afterNavigateDialog = document.querySelector('dialog.place-search-results');
  assert.ok(afterNavigateDialog);
  assert.equal(globalThis.__floatingProps.maxHeight, 340, 'route planning resets the result layer to compact mode');
  assert.equal(globalThis.__floatingProps.expandToViewport, false);
  assert.equal(afterNavigateDialog.querySelector('.place-search-expand-toggle').getAttribute('aria-expanded'), 'false',
    'route planning resets list expansion');
  assert.equal(afterNavigateDialog.querySelector('.place-search-filter-toggle').getAttribute('aria-expanded'), 'false',
    'route planning resets filter expansion');
  assert.equal(afterNavigateDialog.querySelector('select'), null);
  await React.act(async () => afterNavigateDialog.querySelector('[data-place-result]').click());
  assert.equal(globalThis.__selectCalls.length, 1, 'the original result row still selects a place');
  assert.deepEqual(globalThis.__selectCalls[0], navigatePlace);
  assert.ok(document.querySelector('dialog.place-search-results'), 'selecting a result keeps search open');
  let selectedCard = document.querySelector('.place-selected-place');
  assert.ok(selectedCard, 'selecting a result shows an explicit selected-place card');
  assert.equal(globalThis.__searchUiHookArgs.at(-1).enabled, false, 'search requests pause while a place is selected');
  assert.equal(globalThis.__floatingProps.maxHeight, 240, 'selected-place card uses a compact height cap');
  assert.ok(selectedCard.textContent.includes(longName));
  assert.ok(selectedCard.textContent.includes(longAddress));
  assert.ok(selectedCard.textContent.includes('精度未知'), 'selected card preserves the precision warning');
  assert.ok(selectedCard.textContent.includes('天地图'), 'selected card preserves the place source');
  assert.ok(selectedCard.querySelector('.place-search-go'), 'selected card presents the route action');
  assert.ok(selectedCard.querySelector('.place-search-share'), 'selected card retains sharing');
  assert.equal(selectedCard.querySelector('.place-search-go').getAttribute('aria-label'), `去这里：${longName}`);
  await setQueryThroughInput('Edited query');
  assert.equal(document.querySelector('.place-selected-place'), null, 'editing the query clears the selected-place card');
  await setQueryThroughInput('Harbor');
  await React.act(async () => document.querySelector('.place-search-options [data-place-result]').click());
  selectedCard = document.querySelector('.place-selected-place');
  assert.ok(selectedCard);
  await React.act(async () => document.querySelector('.place-search-clear').click());
  assert.equal(document.querySelector('.place-selected-place'), null, 'clearing the query removes the selected-place card');
  assert.ok(document.querySelector('.place-search-history'), 'clearing returns to the history view');
  const restoreHarbor = document.querySelector('[aria-label="重新搜索：Harbor"]');
  assert.ok(restoreHarbor, 'result selection records the actual search phrase');
  await React.act(async () => restoreHarbor.click());
  assert.equal(input.value, 'Harbor');
  await React.act(async () => document.querySelector('.place-search-options [data-place-result]').click());
  selectedCard = document.querySelector('.place-selected-place');
  assert.ok(selectedCard, 'restored results can again show a selected place');
  await React.act(async () => selectedCard.querySelector('.place-selected-place-return').click());
  assert.equal(document.querySelector('.place-selected-place'), null, 'return restores the search results');
  assert.equal(globalThis.__searchUiHookArgs.at(-1).enabled, true, 'return resumes the existing query search');
  assert.equal(input.value, 'Harbor', 'return preserves the query');
  await React.act(async () => document.querySelector('.place-search-options [data-place-result]').click());
  assert.equal(globalThis.__selectCalls.length, 4);
  selectedCard = document.querySelector('.place-selected-place');
  assert.ok(selectedCard);
  await React.act(async () => selectedCard.querySelector('.place-search-go').click());
  assert.equal(globalThis.__navigateEvents.length, 2, 'selected-place action invokes route planning');
  assert.strictEqual(globalThis.__navigateEvents[1][1], navigatePlace);
  assert.equal(document.querySelector('dialog.place-search-results'), null, 'selected-place navigation closes search');

  await React.act(async () => input.click());
  await React.act(async () => document.querySelector('.place-search-clear').click());
  let historyDialog = document.querySelector('dialog.place-search-results');
  assert.ok(historyDialog.querySelector('.place-search-history'));
  assert.ok(historyDialog.querySelector('[aria-label="删除搜索记录：Saved Search A"]'));
  await React.act(async () => historyDialog.querySelector('[aria-label="删除搜索记录：Saved Search A"]').click());
  assert.equal(historyDialog.querySelector('[aria-label="删除搜索记录：Saved Search A"]'), null,
    'deleting a history item removes only that query');
  assert.ok(historyDialog.querySelector('[aria-label="删除搜索记录：Harbor"]'), 'other history entries remain');
  const selectsBeforeRestore = globalThis.__selectCalls.length;
  const navigationsBeforeRestore = globalThis.__navigateEvents.length;
  await React.act(async () => historyDialog.querySelector('[aria-label="重新搜索：Saved Search B"]').click());
  assert.equal(input.value, 'Saved Search B');
  assert.equal(globalThis.__selectCalls.length, selectsBeforeRestore, 'history restore does not select');
  assert.equal(globalThis.__navigateEvents.length, navigationsBeforeRestore, 'history restore does not navigate');
  assert.ok(globalThis.__searchUiHookArgs.some((args) => args.query === 'Saved Search B' && args.enabled),
    'history restore re-enters the existing search flow');
  await React.act(async () => document.querySelector('.place-search-clear').click());
  historyDialog = document.querySelector('dialog.place-search-results');
  await React.act(async () => historyDialog.querySelector('[aria-label="清空搜索记录"]').click());
  assert.match(historyDialog.textContent, /输入地点名称/);
  assert.equal(globalThis.__floatingProps.maxHeight, 76, 'an empty history view stays content-sized');
  assert.equal(historyDialog.querySelector('[aria-label^="重新搜索："]'), null, 'clear removes the remaining history entries');
  assert.equal(globalThis.__selectCalls.length, selectsBeforeRestore, 'history maintenance does not select a place');
  assert.equal(globalThis.__navigateEvents.length, navigationsBeforeRestore, 'history maintenance does not navigate');
});

test('RoutePanel keeps route search options stable while filters collapse and footer paging stays available', async (t) => {
  const { window } = (await import('linkedom')).parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLElement.prototype.scrollIntoView = () => {};
  // Linkedom does not implement browser focus state. Keep this fixture's focus
  // behavior explicit, and compare a small label rather than inspecting React's
  // entire DOM/fiber graph when a focus assertion fails.
  window.HTMLElement.prototype.focus = function () {
    Object.defineProperty(document, 'activeElement', { configurable: true, value: this });
    this.dispatchEvent(new window.Event('focusin', { bubbles: true }));
  };
  window.HTMLElement.prototype.blur = function () {
    if (document.activeElement === this)
      Object.defineProperty(document, 'activeElement', { configurable: true, value: document.body });
  };
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (frame) => clearTimeout(frame);
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
    ['../input/FloatingSearch', 'import React from "react"; export function FloatingSearch(props) { globalThis.__floatingProps = props; return React.createElement("div", {"data-search-owner": props.owner}, props.children); }'],
          ['./usePlaceSearch', `export function usePlaceSearch(args) {
            if (globalThis.__searchUiHookArgs.length >= 200) throw new Error('Unexpected route search render loop: ' + JSON.stringify(args));
            globalThis.__searchUiHookArgs.push(args);
            return globalThis.__searchUiSnapshot;
          }`],
        ]);
        buildApi.onResolve({ filter: /^(\.\/RouteProviderNote|\.\/RouteResultSummary|\.\.\/input\/FloatingSearch|\.\/usePlaceSearch)$/ }, (args) => ({
          path: args.path, namespace: 'route-search-test-double',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'route-search-test-double' }, (args) => ({
          contents: stubs.get(args.path), loader: 'ts', resolveDir: process.cwd(),
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
      { id: 'start', query: '', place: null },
      { id: 'end', query: '', place: null },
    ],
    edit(index, query) { navigation.stops[index] = { ...navigation.stops[index], query }; },
    place(index, place) { navigation.stops[index] = { ...navigation.stops[index], place }; },
    setPicking() {}, reorder() {}, remove() {}, setMode() {}, swap() {}, clear() {},
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
    for (const key of ['__searchUiSnapshot', '__searchUiHookArgs', '__filterChanges', '__loadMoreCalls', '__searchCalls', '__floatingProps', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT', 'window', 'document'])
      delete globalThis[key];
  });

  await React.act(async () => root.render(render()));
  let input = document.querySelector('[data-stop-id="start"] input');
  assert.ok(input);
  await React.act(async () => input.dispatchEvent(new window.Event('focusin', { bubbles: true })));
  assert.equal(document.querySelector('[data-search-owner="route"]'), null, 'empty focused route input does not mount a result popup');
  assert.ok(document.querySelector('.route-search-inline-hint'), 'empty focused route input shows the inline minimum-query hint');
  const reactProps = (node) => node[Object.keys(node).find((key) => key.startsWith('__reactProps$'))];
  const setStartQuery = async (query) => {
    input = document.querySelector('[data-stop-id="start"] input');
    await React.act(async () => reactProps(input).onChange({ target: { value: query } }));
    await React.act(async () => root.render(render()));
  };
  await setStartQuery('H');
  assert.equal(document.querySelector('[data-search-owner="route"]'), null, 'one-character query keeps the popup closed');
  assert.ok(document.querySelector('.route-search-inline-hint'), 'one-character query keeps the inline hint');
  assert.ok(globalThis.__searchUiHookArgs.some((args) => args.query === 'H' && args.enabled));
  await setStartQuery('Harbor');
  let dialog = document.querySelector('dialog.route-place-results');
  assert.ok(dialog, 'two-character-plus route query mounts the result popup');
  assert.ok(document.querySelector('[data-search-owner="route"]'));
  assert.equal(document.querySelector('.route-search-inline-hint'), null, 'inline minimum-query hint hides for a real search');
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
  await React.act(async () => reopenedDialog.querySelector('.place-result-details-toggle').click());
  assert.equal(reopenedDialog.querySelector('.place-search-go'), null,
    'route-stop results never show the direct-navigation action');
  await React.act(async () => reopenedDialog.querySelector('[data-place-result]').click());
  await React.act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(navigation.stops[0].place?.name, 'Route result 1', 'selecting an origin result preserves the endpoint');
  assert.equal(document.activeElement?.getAttribute('aria-label'), '终点',
    'selecting the origin transfers keyboard focus to the destination input');
});

test('route FloatingSearch uses the live map-control-panel rectangle for above/below placement', async (t) => {
  const { window } = (await import('linkedom')).parseHTML('<html><body><div class="observatory home-map"><section id="map-control-panel"><div class="route-panel"><input id="route-anchor" /></div></section></div><div id="root"></div></body></html>');
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    innerHeight: 857,
    innerWidth: 390,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: null });
  const panel = document.getElementById('map-control-panel');
  const anchor = document.getElementById('route-anchor');
  let panelBounds = { top: 260, bottom: 620 };
  const rect = (top, bottom, left = 0, width = 320) => ({
    top, bottom, left, width, height: bottom - top, right: left + width,
    x: left, y: top, toJSON() { return this; },
  });
  panel.getBoundingClientRect = () => rect(panelBounds.top, panelBounds.bottom);
  anchor.getBoundingClientRect = () => rect(400, 428, 16, 280);
  await build({
    entryPoints: ['modules/input/FloatingSearch.tsx'],
    outdir: '.openai/floating-route-geometry-test',
    entryNames: 'FloatingSearch', bundle: true, format: 'esm', platform: 'node',
    packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
  });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { FloatingSearch } = await import('../.openai/floating-route-geometry-test/FloatingSearch.js');
  const root = createRoot(document.getElementById('root'));
  const render = () => React.createElement(FloatingSearch, {
    anchor, owner: 'route', scrollable: true, maxHeight: 205,
  }, React.createElement('div', null, 'route results'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    for (const key of ['window', 'document', 'innerHeight', 'innerWidth', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  });

  await React.act(async () => root.render(render()));
  let popup = document.querySelector('[data-search-owner="route"]');
  assert.ok(popup, 'the real route popup portal is mounted');
  let popupTop = Number.parseFloat(popup.style.top);
  let popupHeight = Number.parseFloat(popup.style.height);
  assert.ok(popupTop + popupHeight <= panelBounds.top,
    `popup (${popupTop}-${popupTop + popupHeight}) sits above map-control-panel (${panelBounds.top}-${panelBounds.bottom})`);

  panelBounds = { top: 80, bottom: 130 };
  await React.act(async () => window.dispatchEvent(new window.Event('resize')));
  popup = document.querySelector('[data-search-owner="route"]');
  popupTop = Number.parseFloat(popup.style.top);
  popupHeight = Number.parseFloat(popup.style.height);
  assert.ok(popupTop >= panelBounds.bottom,
    `popup (${popupTop}-${popupTop + popupHeight}) sits below map-control-panel (${panelBounds.top}-${panelBounds.bottom})`);
});
