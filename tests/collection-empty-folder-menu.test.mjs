import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

async function loadAction() {
  await build({
    entryPoints: ['modules/collections/WorkbenchAction.tsx'],
    outdir: '.openai/collection-empty-folder-menu',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    plugins: [{
      name: 'workbench-action-test-stubs',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\.\.\/input\/SmartText$/ }, () => ({
          path: 'smart-input', namespace: 'action-test',
        }));
        buildApi.onResolve({ filter: /^\.\/WorkbenchShare$/ }, () => ({
          path: 'workbench-share', namespace: 'action-test',
        }));
        buildApi.onLoad({ filter: /.*/, namespace: 'action-test' }, args => ({
          contents: args.path === 'smart-input'
            ? "import { createElement } from 'react'; export function SmartInput(props) { return createElement('input', props); }"
            : "export function WorkbenchShare() { return null; }",
          loader: 'tsx',
          resolveDir: process.cwd(),
        }));
      },
    }],
  });
  return (await import('../.openai/collection-empty-folder-menu/WorkbenchAction.js')).WorkbenchAction;
}

function setupDom() {
  const { window } = parseHTML('<html><body></body></html>');
  Object.assign(globalThis, {
    window,
    document: window.document,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return { window };
}

function props(action, items, onBatch) {
  return {
    action, items, onBatch,
    onClose() {}, onAction() {}, onEdit() { return true; },
    onNew() { return true; }, onMove() { return true; }, onDelete() { return true; },
    onDissolve() { return true; }, async onShare() {}, async onExcel() {},
    onCopy() {}, onOpen() {}, onNavigate() {}, onManage() {},
    error: '', busy: false, canUndo: false, onUndo() { return false; },
  };
}

test('folder menu enables multi-select only when its effective leaf selection is nonempty', async t => {
  setupDom();
  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const WorkbenchAction = await loadAction();
  const root = createRoot(document.createElement('div'));
  const batches = [];
  t.after(async () => act(async () => root.unmount()));

  const emptyItems = [{ id: 'empty', name: '空文件夹', kind: 'folder', color: '#ddd', children: [] }];
  await act(async () => root.render(React.createElement(WorkbenchAction, props(
    { type: 'menu', id: 'empty' }, emptyItems, ids => batches.push(ids),
  ))));
  const findSelection = () => [...document.querySelectorAll('.collection-action-buttons button')]
    .find(button => button.textContent.trim() === '选择 / 多选');
  assert.equal(findSelection().disabled, true, 'an empty folder has no selectable leaves');
  await act(async () => findSelection().click());
  assert.deepEqual(batches, []);

  const folderItems = [{
    id: 'folder', name: '路线', kind: 'folder', color: '#ddd', children: [
      { id: 'pin:a', name: '营地', kind: 'pin', color: '#d44' },
      { id: 'route:b', name: '山路', kind: 'route', color: '#4a6' },
    ],
  }];
  await act(async () => root.render(React.createElement(WorkbenchAction, props(
    { type: 'menu', id: 'folder' }, folderItems, ids => batches.push(ids),
  ))));
  const fullFolderSelection = findSelection();
  assert.equal(fullFolderSelection.disabled, false);
  await act(async () => fullFolderSelection.click());
  assert.deepEqual(batches, [['pin:a', 'route:b']], 'folder selection passes leaves, not the folder id');

  await act(async () => root.render(React.createElement(WorkbenchAction, props(
    { type: 'menu', id: 'folder', scopedIds: ['pin:a'] }, folderItems, ids => batches.push(ids),
  ))));
  const scopedSelection = findSelection();
  assert.equal(scopedSelection.disabled, false);
  await act(async () => scopedSelection.click());
  assert.deepEqual(batches, [['pin:a', 'route:b'], ['pin:a']], 'region-scoped selection remains scoped');
});
