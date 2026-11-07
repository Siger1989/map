import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('annotation coordinate copy uses exact Google order, preserves unknown elevation, and drops stale feedback', async (t) => {
  const { window } = (await import('linkedom')).parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  globalThis.__coordinateClipboardCalls = [];
  globalThis.__coordinateClipboardPending = null;

  await build({
    entryPoints: ['modules/annotations/AnnotationCoordinateInfo.tsx'],
    outfile: '.openai/annotation-coordinate-info-test.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    plugins: [{
      name: 'clipboard-and-css-stubs',
      setup(api) {
        api.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty-css', namespace: 'test-css' }));
        api.onLoad({ filter: /.*/, namespace: 'test-css' }, () => ({ contents: '', loader: 'js' }));
        api.onResolve({ filter: /platform\/macNative/ }, () => ({ path: 'clipboard', namespace: 'test-clipboard' }));
        api.onLoad({ filter: /.*/, namespace: 'test-clipboard' }, () => ({
          contents: `export async function writeClipboard(text) {
            globalThis.__coordinateClipboardCalls.push(text);
            if (globalThis.__coordinateClipboardPending) return await new Promise(resolve => { globalThis.__coordinateClipboardPending.resolve = resolve; });
          }`,
          loader: 'js',
        }));
      },
    }],
  });

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { AnnotationCoordinateInfo } = await import('../.openai/annotation-coordinate-info-test.js');
  const root = createRoot(document.getElementById('root'));
  const render = (props) => React.createElement(AnnotationCoordinateInfo, props);
  t.after(async () => {
    await React.act(async () => root.unmount());
    delete globalThis.__coordinateClipboardCalls;
    delete globalThis.__coordinateClipboardPending;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.window;
    delete globalThis.document;
  });

  await React.act(async () => root.render(render({
    annotationId: 'a', coordinates: [116.4074, 39.9042], elevation: null,
  })));
  assert.match(document.querySelector('.annotation-coordinate-info-elevation').textContent, /海拔未取得/);
  await React.act(async () => document.querySelector('button').click());
  assert.deepEqual(globalThis.__coordinateClipboardCalls, ['39.9042, 116.4074']);
  assert.match(document.querySelector('[role="status"]').textContent, /已复制/);

  globalThis.__coordinateClipboardPending = {};
  await React.act(async () => document.querySelector('button').click());
  await React.act(async () => root.render(render({
    annotationId: 'b', coordinates: [151.2093, -33.8688], elevation: null, preview: true,
  })));
  await React.act(async () => globalThis.__coordinateClipboardPending.resolve());
  assert.doesNotMatch(document.querySelector('[role="status"]').textContent, /已复制/,
    'a completed copy from the previous selected marker must not update the new marker panel');
  assert.match(document.querySelector('strong').textContent, /预览坐标/);
});
