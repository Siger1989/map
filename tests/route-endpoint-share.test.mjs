import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { placeShareData } from '../modules/placeShare/data.ts';

test('route endpoints copy exact WGS84 coordinates and share the selected endpoint through place sharing', { timeout: 30000 }, async (t) => {
  await build({ entryPoints: ['modules/tracks/RouteEndpointActions.tsx'], outfile: '.openai/route-endpoint-actions-test.mjs', bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
  const { RouteEndpointActions, routeEndpointPlace } = await import('../.openai/route-endpoint-actions-test.mjs');
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const clipboard = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Node test', clipboard: { async writeText(value) { clipboard.push(value); } } } });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await React.act(async () => root.unmount()); });
  const shared = [], point = [103.8356394, 31.4698443];
  await React.act(async () => root.render(React.createElement(RouteEndpointActions, { routeName: '山脊路线', label: '起点', stopName: '山口', point, onShare: place => shared.push(place) })));
  await React.act(async () => document.querySelector('[aria-label="复制起点坐标"]').click());
  assert.deepEqual(clipboard, ['103.835639, 31.469844']);
  assert.match(document.querySelector('[role="status"]').textContent, /经度在前/);
  await React.act(async () => document.querySelector('[aria-label="分享起点地点"]').click());
  assert.deepEqual(shared, [{ name: '山脊路线 · 起点 · 山口', coordinates: point }]);
  assert.notEqual(shared[0].coordinates, point);
  assert.equal(new URL(placeShareData(shared[0]).url).searchParams.get('position'), point.join(','));

  navigator.clipboard.writeText = async () => { throw Error('denied'); };
  await React.act(async () => document.querySelector('[aria-label="复制起点坐标"]').click());
  assert.match(document.querySelector('[role="status"]').textContent, /复制失败/);
  assert.equal(document.querySelector('[aria-label="分享起点地点"]').disabled, false);
  assert.throws(() => routeEndpointPlace('路线', '终点', undefined, [NaN, 31]), /坐标无效/);
});
