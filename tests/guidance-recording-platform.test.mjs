import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { mkdir } from 'node:fs/promises';

test('navigation auto-recording follows the platform capability and existing recording state', async t => {
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const output = '.openai/guidance-recording-platform/useGuidanceWorkflow.mjs';
  await mkdir('.openai/guidance-recording-platform', { recursive: true });
  await build({
    entryPoints: ['modules/workbench/useGuidanceWorkflow.ts'],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [{
      name: 'guidance-workflow-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /^(\.\.\/navigation\/favorites|\.\.\/guidance\/(savedRoute|session|trackConnections)|\.\.\/navigation\/provider)$/ }, args => ({ path: args.path, namespace: 'workflow-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'workflow-fixture' }, args => {
          const fixtures = {
            '../navigation/favorites': 'export const validFavorite = () => true;',
            '../guidance/savedRoute': 'export class RouteDisconnectedError extends Error {} export class RouteEndpointRequiredError extends Error {} export const trackNavigation = () => null;',
            '../guidance/session': 'export const freshFix = () => true;',
            '../guidance/trackConnections': 'export const resolveTrackConnections = async route => route;',
            '../navigation/provider': 'export const planRoute = async () => null;',
          };
          return { contents: fixtures[args.path], loader: 'js' };
        });
      },
    }],
  });

  const React = await import('react');
  const { act } = React;
  const { createRoot } = await import('react-dom/client');
  const { useGuidanceWorkflow } = await import(`../${output.replaceAll('\\', '/')}`);

  async function exercise({ recordingEnabled, policy = true, phase = 'idle', navigationStarts = true }) {
    const route = { geometryKind: 'road', coordinates: [[104, 30], [104.01, 30.01]] };
    const calls = { commands: [], guidanceStarts: [], invalid: 0, located: 0, activated: 0 };
    const input = {
      guidance: {
        active: false,
        session: null,
        start(value) { calls.guidanceStarts.push(value); return navigationStarts; },
        replaceRoute() {},
      },
      position: {
        watching: false,
        mode: 'auto',
        stopLocation() {}, free() {}, changeMode() {},
        locate() { calls.located++; },
      },
      follow: { pause() {}, resume() {} },
      recorder: {
        record: { phase },
        command(action) { calls.commands.push(action); },
        sampling: { policy: { recordOnNavigation: policy } },
      },
      navigation: {
        route,
        start: { name: '起点', coordinates: route.coordinates[0] },
        end: { name: '终点', coordinates: route.coordinates[1] },
        restore() { return true; }, adoptRoute() {},
      },
      tracks: { saved: [], selectedId: null },
      map: { current: {
        focusCenter() {}, previewRoute() {}, clearRouteGap() {}, clearRouteIssue() {},
      } },
      activeAlternative: '',
      onOpenRoute() {},
      onActivateUi() { calls.activated++; },
      onInvalidRoute() { calls.invalid++; },
      ...(recordingEnabled === undefined ? {} : { recordingEnabled }),
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let workflow;
    function Probe() {
      workflow = useGuidanceWorkflow(input);
      return null;
    }
    await act(async () => root.render(React.createElement(Probe)));
    await act(async () => workflow.startGuidance());
    await act(async () => root.unmount());
    host.remove();
    return { calls, route };
  }

  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });

  const desktop = await exercise({ recordingEnabled: false });
  assert.deepEqual(desktop.calls.commands, [], 'desktop navigation must not start a recording');
  assert.deepEqual(desktop.calls.guidanceStarts, [desktop.route], 'desktop navigation still starts normally');
  assert.equal(desktop.calls.located, 1, 'desktop navigation still begins its location lifecycle');
  assert.equal(desktop.calls.activated, 1);

  const phone = await exercise({});
  assert.deepEqual(phone.calls.commands, ['start'], 'the default capability preserves phone auto-recording');
  assert.deepEqual(phone.calls.guidanceStarts, [phone.route]);

  const optedOut = await exercise({ recordingEnabled: true, policy: false });
  assert.deepEqual(optedOut.calls.commands, [], 'a disabled sampling preference does not start a recording');

  const existing = await exercise({ recordingEnabled: true, phase: 'paused' });
  assert.deepEqual(existing.calls.commands, [], 'an existing recording is not restarted');

  const failed = await exercise({ recordingEnabled: true, navigationStarts: false });
  assert.deepEqual(failed.calls.commands, [], 'a rejected navigation does not start a recording');
  assert.equal(failed.calls.invalid, 1);
  assert.equal(failed.calls.located, 0);
});
