import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

async function loadRouteViews() {
  await build({
    stdin: {
      contents: "export { RouteResultSummary } from './modules/navigation/RouteResultSummary'; export { RouteRemovalControl } from './modules/navigation/RouteRemovalControl';",
      resolveDir: process.cwd(), loader: 'tsx',
    },
    outfile: '.openai/route-removal-test/RouteViews.js', bundle: true, format: 'esm', platform: 'node',
    packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' },
    plugins: [{ name: 'route-removal-test-stubs', setup(api) {
      api.onResolve({ filter: /\.\/RouteProviderNote$/ }, () => ({ path: 'route-provider-note', namespace: 'route-removal-stub' }));
      api.onResolve({ filter: /\.\.\/journey\/RouteElevationSummary$/ }, () => ({ path: 'route-elevation-summary', namespace: 'route-removal-stub' }));
      api.onLoad({ filter: /.*/, namespace: 'route-removal-stub' }, args => ({
        contents: args.path === 'route-provider-note'
          ? "export function RouteProviderNote(){return null;}"
          : "export function RouteElevationSummary(){return null;}",
        loader: 'tsx', resolveDir: process.cwd(),
      }));
    } }],
  });
  return import('../.openai/route-removal-test/RouteViews.js');
}

function setupDom() {
  const { window } = parseHTML('<html><body></body></html>');
  let activeElement = null;
  Object.defineProperty(window.document, 'activeElement', { configurable: true, get: () => activeElement });
  window.HTMLElement.prototype.focus = function focus() { activeElement = this; };
  Object.assign(globalThis, {
    window, document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  return window;
}

const routeProps = onCancel => ({
  route: {
    name: '当前规划', mode: 'pedestrian', distance: 1200, duration: 1000,
    coordinates: [[104, 30], [104.01, 30.01]], createdAt: 1,
  },
  start: { name: '起点' }, end: { name: '终点' }, mode: 'pedestrian',
  loading: false, planningError: '', onModeChange() {}, onSwap() {}, onShow() {}, onEdit() {},
  onSave() {}, onShare() {}, onStartNavigation() {}, navigating: false, guidanceError: '',
  saveMessage: '', onCancel,
});

test('planned route summary keeps four second-row actions and delete cancel leaves the plan untouched', async t => {
  setupDom();
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { RouteResultSummary } = await loadRouteViews();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let removals = 0;
  t.after(async () => React.act(async () => root.unmount()));
  await React.act(async () => root.render(React.createElement(RouteResultSummary, routeProps(() => { removals++; }))));

  const secondary = host.querySelector('.route-summary-actions-secondary');
  assert.ok(secondary);
  assert.deepEqual([...secondary.querySelectorAll('button')].map(button => button.textContent), ['收藏', '分享', '详情', '删除']);
  await React.act(async () => secondary.querySelector('[aria-label="删除"]').click());
  const dialog = host.querySelector('[role="alertdialog"][aria-label="确认删除当前规划路线"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(document.activeElement.textContent, '取消', 'opening the confirmation moves focus inside it');
  assert.equal(dialog.textContent.includes('删除当前规划路线？已保存的收藏、轨迹和标记保留。'), true);
  assert.equal(removals, 0);
  const escape = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  await React.act(async () => dialog.dispatchEvent(escape));
  assert.equal(host.querySelector('[role="alertdialog"]'), null, 'Escape closes without removing');
  assert.equal(document.activeElement.getAttribute('aria-label'), '删除', 'Escape returns focus to the delete button');

  await React.act(async () => secondary.querySelector('[aria-label="删除"]').click());
  const reopened = host.querySelector('[role="alertdialog"]');
  assert.ok(reopened);
  await React.act(async () => reopened.querySelector('button').click());
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
  assert.equal(removals, 0, 'cancel returns to the card without changing navigation state');
  assert.equal(document.activeElement.getAttribute('aria-label'), '删除');

  await React.act(async () => secondary.querySelector('[aria-label="删除"]').click());
  await React.act(async () => host.querySelector('button[aria-label="确认删除当前规划路线"]').click());
  assert.equal(removals, 1, 'explicit confirmation calls route removal once');
  assert.equal(host.querySelector('[role="alertdialog"]'), null);
});

test('removal is guarded while an async callback is pending and false keeps the confirmation open', async t => {
  const window = setupDom();
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { RouteRemovalControl } = await loadRouteViews();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  t.after(async () => React.act(async () => root.unmount()));

  let settle;
  let removals = 0;
  await React.act(async () => root.render(React.createElement(RouteRemovalControl, {
    onRemove: () => { removals++; return new Promise(resolve => { settle = resolve; }); },
  })));
  await React.act(async () => host.querySelector('[aria-label="删除"]').click());
  const confirm = host.querySelector('button[aria-label="确认删除当前规划路线"]');
  await React.act(async () => confirm.click());
  assert.equal(removals, 1);
  const pendingConfirm = host.querySelector('button[aria-label="确认删除当前规划路线"]');
  assert.equal(pendingConfirm.disabled, true);
  const busyDialog = host.querySelector('[role="alertdialog"]');
  const escape = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  await React.act(async () => busyDialog.dispatchEvent(escape));
  assert.ok(host.querySelector('[role="alertdialog"]'), 'Escape cannot interrupt an active removal');
  assert.equal(document.activeElement, busyDialog);
  await React.act(async () => pendingConfirm.dispatchEvent(new window.Event('click', { bubbles: true })));
  assert.equal(removals, 1, 'busy guard rejects a repeated confirmation event');
  await React.act(async () => settle(true));
  assert.equal(host.querySelector('[role="alertdialog"]'), null);

  await React.act(async () => root.render(React.createElement(RouteRemovalControl, { onRemove: () => false })));
  await React.act(async () => host.querySelector('[aria-label="删除"]').click());
  await React.act(async () => host.querySelector('button[aria-label="确认删除当前规划路线"]').click());
  assert.ok(host.querySelector('[role="alertdialog"]'), 'a failed remove keeps the card and confirmation visible');
  assert.ok(host.querySelector('[role="alert"]').textContent.includes('路线显示状态未保存'));
});
