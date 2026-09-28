import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const fixture = (hidden = false) => ({
  data: { collections: { tabOrder: ['all', 'hidden'] } },
  commits: [],
  items: [{
    id: 'unfiled', name: '未分组', kind: 'folder', color: '#dce5df',
    children: [
      { id: 'pin:a', name: '营地', kind: 'pin', color: '#d44', visible: !hidden },
      { id: 'route:b', name: '山路', kind: 'route', color: '#4a6', visible: true },
    ],
  }],
});

const stubSources = {
  '../input/SmartText': `import { createElement } from 'react'; export function SmartInput(props) { return createElement('input', props); }`,
  './useWorkbenchData': `
    import { useState } from 'react';
    export function useWorkbenchData() {
      const fixture = globalThis.__collectionVisibilityFixture;
      const [snapshot, setSnapshot] = useState(() => ({ data: fixture.data, items: fixture.items }));
      return {
        ...snapshot, ready: true, error: '', canUndo: false,
        commit(items) {
          fixture.commits.push(items);
          setSnapshot(previous => ({ data: { ...previous.data, revision: (previous.data.revision || 0) + 1 }, items }));
          return true;
        },
        reorderTabs() { return true; }, restore() { return false; },
      };
    }
  `,
  './useWorkbenchLongPress': `export function useWorkbenchLongPress() { return { drag: null, start() {}, suppressClick() { return false; } }; }`,
  './WorkbenchSort': `import { createElement } from 'react'; export const WORKBENCH_SORTS = []; export function sortWorkbenchItems(items) { return items; } export function workbenchDistance() { return 0; } export function WorkbenchSort() { return null; }`,
  './WorkbenchAction': `export function WorkbenchAction() { return null; }`,
  './CollectionTabs': `import { createElement } from 'react'; export function CollectionTabs({ onSelect }) { return createElement('div', { className: 'test-tabs' }, createElement('button', { onClick: () => onSelect('all') }, '全部'), createElement('button', { onClick: () => onSelect('hidden') }, '隐藏')); }`,
  './folderTheme': `export function folderTheme() { return {}; }`,
  '../files/delivery': `export async function deliverFile() { return ''; }`,
  '../annotations/spreadsheet': `export function annotationSpreadsheet() { return new Blob(); }`,
  '../annotations/spreadsheetRegions': `export async function spreadsheetRegions() { return { regions: {}, unresolved: 0 }; }`,
  '../files/spreadsheet': `export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';`,
  './export': `export function collectionSpreadsheet() { return new Blob(); } export function collectionTransfer() { return {}; }`,
  './catalog': `export function catalogEntries() { return []; }`,
  './workbenchShareData': `export function workbenchShareIds(ids) { return ids ?? []; } export function selectedWorkbenchKeys(_items, ids) { return ids; }`,
};

async function loadPanel() {
  await build({
    entryPoints: ['modules/collections/WorkbenchPanel.tsx'],
    outdir: '.openai/collection-visibility-swipe',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'workbench-test-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, args => {
          const source = stubSources[args.path];
          return source === undefined ? undefined : { path: args.path, namespace: 'workbench-stub' };
        });
        buildApi.onLoad({ filter: /.*/, namespace: 'workbench-stub' }, args => ({
          contents: stubSources[args.path],
          loader: 'tsx',
          resolveDir: process.cwd(),
        }));
      },
    }],
  });
  return (await import('../.openai/collection-visibility-swipe/WorkbenchPanel.js')).WorkbenchPanel;
}

function setupDom() {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  const frames = new Map();
  let nextFrame = 1;
  window.requestAnimationFrame = callback => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.PointerEvent = window.Event;
  const captures = new WeakMap();
  window.HTMLElement.prototype.setPointerCapture = function (id) { captures.set(this, id); };
  window.HTMLElement.prototype.hasPointerCapture = function (id) { return captures.get(this) === id; };
  window.HTMLElement.prototype.releasePointerCapture = function (id) {
    if (captures.get(this) === id) captures.delete(this);
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return { window, frames };
}

function pointer(window, type, y, pointerId = 1) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId, pointerType: 'touch', isPrimary: true, button: 0,
    clientX: 10, clientY: y,
  });
  return event;
}

function layOutRows(host) {
  const list = host.querySelector('.workbench-tree-list');
  list.getBoundingClientRect = () => ({ top: 0, bottom: 300, left: 0, right: 320, width: 320, height: 300 });
  [...list.querySelectorAll('[data-visibility-key]')].forEach((button, index) => {
    const top = index * 40;
    button.getBoundingClientRect = () => ({ top, bottom: top + 36, left: 0, right: 320, width: 320, height: 36 });
  });
}

test('visibility gutter previews each painted row, commits once on release, and restores on cancel', async t => {
  const { window } = setupDom();
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const WorkbenchPanel = await loadPanel();
  const mounted = [];
  t.after(async () => {
    for (const { root } of mounted) await act(async () => root.unmount());
  });

  async function mount(initial) {
    globalThis.__collectionVisibilityFixture = initial;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    await act(async () => root.render(React.createElement(WorkbenchPanel, {
      center: [104, 30], onClose() {}, onLocate() {}, onOpen() {}, onNavigate() {}, onManage() {},
    })));
    layOutRows(host);
    return host;
  }

  const allVisible = fixture();
  let host = await mount(allVisible);
  const first = host.querySelector('[data-visibility-key$="/pin:a"]');
  const second = host.querySelector('[data-visibility-key$="/route:b"]');
  assert.equal(first.getAttribute('aria-pressed'), 'true');
  await act(async () => first.dispatchEvent(pointer(window, 'pointerdown', 50)));
  assert.equal(first.getAttribute('aria-pressed'), 'false', 'the starting row previews immediately');
  assert.equal(allVisible.commits.length, 0, 'preview has not reached persistence');
  await act(async () => first.dispatchEvent(pointer(window, 'pointermove', 90)));
  assert.equal(first.getAttribute('aria-pressed'), 'false');
  assert.equal(second.getAttribute('aria-pressed'), 'false', 'the row under the finger previews too');
  assert.equal(allVisible.commits.length, 0, 'crossing rows still does not commit');
  await act(async () => first.dispatchEvent(pointer(window, 'pointerup', 90)));
  assert.equal(allVisible.commits.length, 1, 'release creates exactly one commit');
  const hiddenAfterRelease = allVisible.commits[0][0].children;
  assert.deepEqual(hiddenAfterRelease.map(item => [item.id, item.visible]), [
    ['pin:a', false], ['route:b', false],
  ], 'all crossed leaves receive the initial hide direction');

  const cancelFixture = fixture();
  host = await mount(cancelFixture);
  const cancelButton = host.querySelector('[data-visibility-key$="/pin:a"]');
  await act(async () => cancelButton.dispatchEvent(pointer(window, 'pointerdown', 50, 2)));
  assert.equal(cancelButton.getAttribute('aria-pressed'), 'false');
  assert.equal(cancelFixture.commits.length, 0);
  await act(async () => cancelButton.dispatchEvent(pointer(window, 'pointercancel', 50, 2)));
  assert.equal(cancelButton.getAttribute('aria-pressed'), 'true', 'cancel removes the temporary preview');
  assert.equal(cancelFixture.commits.length, 0, 'cancel does not persist visibility');
});

test('hidden-filter rows stay mounted during show preview and disappear only after release commits', async t => {
  const { window } = setupDom();
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const WorkbenchPanel = await loadPanel();
  const initial = fixture(true);
  globalThis.__collectionVisibilityFixture = initial;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => act(async () => root.unmount()));
  await act(async () => root.render(React.createElement(WorkbenchPanel, {
    center: [104, 30], onClose() {}, onLocate() {}, onOpen() {}, onNavigate() {}, onManage() {},
  })));
  await act(async () => host.querySelector('.test-tabs button:nth-child(2)').click());
  layOutRows(host);
  let hidden = host.querySelector('[data-visibility-key$="/pin:a"]');
  assert.ok(hidden, 'the initially hidden item appears in the hidden filter');
  await act(async () => hidden.dispatchEvent(pointer(window, 'pointerdown', 50, 3)));
  hidden = host.querySelector('[data-visibility-key$="/pin:a"]');
  assert.ok(hidden, 'show preview does not filter against temporary visibility');
  assert.equal(hidden.getAttribute('aria-pressed'), 'true');
  assert.equal(initial.commits.length, 0);
  await act(async () => hidden.dispatchEvent(pointer(window, 'pointerup', 50, 3)));
  assert.equal(initial.commits.length, 1);
  assert.equal(host.querySelector('[data-visibility-key$="/pin:a"]'), null, 'the committed visible row leaves the hidden filter');
});
