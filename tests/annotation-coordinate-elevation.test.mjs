import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('selected annotation elevation ignores stale reads, samples only on release, and remains read-only', async (t) => {
  const { window } = (await import('linkedom')).parseHTML('<html><body><div id="root"></div></body></html>');
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    actEnvironment: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, {
    window,
    document: window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
    __elevationRequests: [],
    __annotationStorageWrites: 0,
    localStorage: {
      getItem() { return null; },
      setItem() { globalThis.__annotationStorageWrites++; },
      removeItem() { globalThis.__annotationStorageWrites++; },
    },
  });

  await build({
    entryPoints: ['modules/annotations/useAnnotationCoordinateElevation.ts'],
    outfile: '.openai/annotation-coordinate-elevation-test.js',
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    plugins: [{
      name: 'deferred-elevation-reader',
      setup(api) {
        api.onResolve({ filter: /terrain\/elevation$/ }, () => ({ path: 'elevation-reader', namespace: 'test-elevation' }));
        api.onLoad({ filter: /.*/, namespace: 'test-elevation' }, () => ({
          contents: `export function readElevation(longitude, latitude, signal) {
            let resolve;
            let reject;
            const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
            globalThis.__elevationRequests.push({ longitude, latitude, signal, promise, resolve, reject });
            return promise;
          }`,
          loader: 'js',
        }));
      },
    }],
  });

  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { useAnnotationCoordinateElevation } = await import('../.openai/annotation-coordinate-elevation-test.js');
  const root = createRoot(document.getElementById('root'));
  const cachedValues = new Map([
    ['10,20', 0],
    ['30,40', -123.4],
  ]);
  const cached = (point) => cachedValues.has(point.join(',')) ? cachedValues.get(point.join(',')) : null;

  function SelectedMarker(props) {
    const value = useAnnotationCoordinateElevation(
      props.annotationId, props.coordinates, !!props.preview, cached,
    );
    return React.createElement('output', {
      'data-elevation': value.elevation === null ? 'unknown' : String(value.elevation),
      'data-status': value.status,
    });
  }
  function View({ open, ...props }) {
    return open ? React.createElement(SelectedMarker, props) : null;
  }

  const render = async (props) => React.act(async () => root.render(React.createElement(View, props)));
  const flush = async () => React.act(async () => { await Promise.resolve(); });
  const output = () => document.querySelector('output');
  const requests = () => globalThis.__elevationRequests;
  const settle = async (request, value) => {
    await React.act(async () => {
      request.resolve(value);
      await request.promise;
    });
  };

  t.after(async () => {
    await React.act(async () => root.unmount());
    delete globalThis.__elevationRequests;
    delete globalThis.__annotationStorageWrites;
    for (const key of ['window', 'document', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT']) {
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
    }
  });

  await render({ open: true, annotationId: 'zero', coordinates: [10, 20] });
  await flush();
  assert.equal(output().dataset.elevation, '0', 'a cached zero elevation is a valid result');
  assert.equal(requests().length, 0, 'cached zero does not trigger a network read');

  await render({ open: true, annotationId: 'below-sea-level', coordinates: [30, 40] });
  await flush();
  assert.equal(output().dataset.elevation, '-123.4', 'a cached negative elevation is preserved');
  assert.equal(requests().length, 0, 'cached negative elevation does not trigger a network read');

  await render({ open: true, annotationId: 'old', coordinates: [1, 2] });
  await flush();
  assert.equal(requests().length, 1);
  const oldSelection = requests()[0];
  assert.equal(output().dataset.elevation, 'unknown', 'unknown elevation stays unknown while a read is pending');

  await render({ open: true, annotationId: 'old', coordinates: [1.5, 2.5] });
  await flush();
  assert.equal(oldSelection.signal.aborted, true, 'changing coordinates cancels the pending read even for the same marker');
  assert.equal(requests().length, 2);
  const oldCoordinate = requests()[1];
  assert.deepEqual([oldCoordinate.longitude, oldCoordinate.latitude], [1.5, 2.5]);
  await settle(oldSelection, 8888);
  assert.equal(output().dataset.elevation, 'unknown', 'a late result from the previous coordinate is ignored');

  await render({ open: true, annotationId: 'new', coordinates: [3, 4] });
  await flush();
  assert.equal(oldCoordinate.signal.aborted, true, 'changing the selected marker cancels its pending read');
  assert.equal(requests().length, 3);
  const newSelection = requests()[2];
  assert.deepEqual([newSelection.longitude, newSelection.latitude], [3, 4]);
  await settle(oldCoordinate, 7777);
  assert.equal(output().dataset.elevation, 'unknown', 'a late result from the prior selection is ignored');
  await settle(newSelection, -8.5);
  assert.equal(output().dataset.elevation, '-8.5', 'a negative result from the current selection is preserved');

  await render({ open: true, annotationId: 'new', coordinates: [5, 6], preview: true });
  await render({ open: true, annotationId: 'new', coordinates: [7, 8], preview: true });
  await flush();
  assert.equal(requests().length, 3, 'drag preview coordinate changes do not issue elevation reads');
  assert.equal(output().dataset.elevation, 'unknown', 'the settled marker elevation is hidden during preview');

  await render({ open: true, annotationId: 'new', coordinates: [7, 8], preview: false });
  await flush();
  assert.equal(requests().length, 4, 'release starts one read at the final dragged coordinate');
  const released = requests()[3];
  assert.deepEqual([released.longitude, released.latitude], [7, 8]);
  assert.equal(output().dataset.elevation, 'unknown', 'an uncached result is not converted to zero');
  await settle(released, 0);
  assert.equal(output().dataset.elevation, '0', 'a sampled sea-level result remains zero');

  await render({ open: true, annotationId: 'closing', coordinates: [9, 10] });
  await flush();
  assert.equal(requests().length, 5);
  const closingRead = requests()[4];
  await render({ open: false });
  assert.equal(closingRead.signal.aborted, true, 'closing the selected marker cancels its pending read');
  await settle(closingRead, 99999);
  assert.equal(output(), null, 'a late result after close has no mounted marker panel to update');

  await render({ open: true, annotationId: 'reopened', coordinates: [11, 12] });
  await flush();
  assert.equal(requests().length, 6);
  const reopenedRead = requests()[5];
  await settle(closingRead, -777);
  assert.equal(output().dataset.elevation, 'unknown', 'a late closed-marker result cannot leak into a reopened marker');
  await settle(reopenedRead, 145.25);
  assert.equal(output().dataset.elevation, '145.25');
  assert.equal(globalThis.__annotationStorageWrites, 0, 'sampling elevation does not write saved annotations');
});
