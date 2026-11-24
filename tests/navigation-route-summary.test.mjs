import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { mkdir } from 'node:fs/promises';

test('the route details dialog loads a bounded profile and retains it when closed', async () => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  await mkdir('.openai', { recursive: true });
  await build({
    entryPoints: ['modules/navigation/RouteResultSummary.tsx'],
    outfile: '.openai/navigation-route-summary-check.mjs',
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    plugins: [{
      name: 'route-summary-test-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /^recharts$/ }, () => ({ path: 'recharts', namespace: 'fixture' }));
        builder.onResolve({ filter: /RouteProviderNote/ }, () => ({ path: 'provider-note', namespace: 'fixture' }));
        builder.onResolve({ filter: /elevationProvider/ }, () => ({ path: 'elevation-provider', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
          resolveDir: process.cwd(),
          contents: args.path === 'recharts'
            ? `import React from 'react';
               export const Area=()=>null, CartesianGrid=()=>null, XAxis=()=>null, YAxis=()=>null;
               export const AreaChart=({children})=>React.createElement('div',{'data-testid':'profile-chart'},children);
               export const ResponsiveContainer=({children})=>React.createElement('div',null,children);`
            : args.path === 'provider-note'
              ? `import React from 'react'; export const RouteProviderNote=()=>React.createElement('div',null,'数据来源');`
              : `export async function readProfile(samples, signal) { return globalThis.readRouteProfile(samples, signal); }`,
        }));
      },
    }],
  });

  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { RouteResultSummary } = await import('../.openai/navigation-route-summary-check.mjs');
  const coordinates = Array.from({ length: 1100 }, (_, index) => [103 + index * 0.001, 30]);
  const route = {
    coordinates,
    distance: 106_000,
    duration: 24_000,
    steps: [
      { instruction: '出发', distance: 0 },
      { instruction: '沿虚线前往道路接入点', distance: 200 },
      { instruction: '左转', distance: 900 },
    ],
    createdAt: 10,
  };
  const originalRoute = JSON.stringify(route);
  const profileRequests = [];
  globalThis.readRouteProfile = async (samples, signal) => {
    profileRequests.push(samples);
    return samples.map((sample, index) => ({
      ...sample,
      elevation: index === 1 || index === 80 ? null : 800 + index,
    }));
  };
  let showCalls = 0;
  const appliedModes = [];
  let swapCalls = 0;
  const host = document.getElementById('root');
  const root = createRoot(host);
  const props = {
    route,
    start: { name: '绿色起点' },
    end: { name: '红色终点' },
    mode: 'auto',
    loading: false,
    planningError: '',
    onModeChange(mode) { appliedModes.push(mode); },
    onSwap() { swapCalls++; },
    onShow() { showCalls++; },
    onEdit() {},
    onSave() {},
    onShare() {},
    onStartNavigation() {},
    navigating: false,
    guidanceError: '',
    saveMessage: '',
  };

  await act(async () => root.render(React.createElement(RouteResultSummary, props)));
  const details = host.querySelector('[aria-haspopup="dialog"]');
  const dialog = () => document.querySelector('[role="dialog"][aria-label="路线详情"]');
  assert.equal(details.textContent, '路线详情');
  assert.equal(host.querySelector('.route-summary-modes button[aria-pressed="true"]').textContent, '驾车');
  assert.equal(dialog(), null, 'opening the summary does not request the profile');
  await act(async () => details.click());
  assert.deepEqual([...dialog().querySelectorAll('.route-data-rows dd')].map(row => row.textContent), ['绿色起点', '红色终点']);
  await act(async () => dialog().querySelector('[aria-label="交换起点和终点"]').click());
  assert.equal(swapCalls, 1, 'endpoint exchange uses the existing planning callback');
  await act(async () => host.querySelector('.route-summary-modes button[aria-label="骑行"]').click());
  assert.deepEqual(appliedModes, ['bicycle'], 'mode selection is wired to automatic replanning');

  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  assert.equal(details.textContent, '路线详情');
  assert.equal(profileRequests.length, 1);
  assert.ok(profileRequests[0].length > 100 && profileRequests[0].length <= 192, 'long routes use the bounded sample count');
  assert.ok(dialog().querySelector('[data-testid="profile-chart"]'), 'available height renders a profile');
  assert.match(dialog().textContent, /部分海拔缺失/);
  assert.match(dialog().textContent, /最高海拔.*9\d+ m/);
  assert.doesNotMatch(dialog().textContent, /出发|沿虚线前往道路接入点|左转/);
  assert.equal(dialog().querySelector('[aria-label="沿途天气"]'), null);
  assert.equal(showCalls, 0, 'opening details does not move the map');
  assert.equal(JSON.stringify(route), originalRoute, 'the planned route stays unchanged');

  await act(async () => dialog().querySelector('.route-back').click());
  assert.equal(dialog().parentElement.hidden, true);
  await act(async () => details.click());
  assert.equal(dialog().parentElement.hidden, false);
  assert.equal(profileRequests.length, 1, 'closing and reopening retains the loaded elevation profile');
  assert.equal(showCalls, 0);
  await act(async () => root.unmount());
  delete globalThis.readRouteProfile;
});
