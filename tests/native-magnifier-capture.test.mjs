import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createMagnifierCapturePump } from '../modules/map/native/magnifierCapture.ts';
import { magnifierCropWindow } from '../modules/map/native/magnifierCrop.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('native magnifier keeps one capture in flight and paints with the latest moving aim point', async () => {
  const requests = [], paints = [];
  let concurrent = 0, maximumConcurrent = 0;
  const pump = createMagnifierCapturePump(() => {
    const request = deferred();
    requests.push(request);
    concurrent++;
    maximumConcurrent = Math.max(maximumConcurrent, concurrent);
    return request.promise.finally(() => concurrent--);
  }, (frame, point) => paints.push({ frame, point }), 0);

  pump.update({ x: 10, y: 20 });
  await tick();
  assert.equal(requests.length, 1);
  pump.update({ x: 30, y: 40 });
  pump.update({ x: 50, y: 60 });
  await tick();
  assert.equal(requests.length, 1, 'updates while PixelCopy/bridge is pending are coalesced');
  requests[0].resolve('frame-1');
  await tick();
  assert.equal(requests.length, 2, 'one fresh capture starts after the outstanding request completes');
  assert.deepEqual(paints, [{ frame: 'frame-1', point: { x: 50, y: 60 } }]);

  pump.update({ x: 70, y: 80 });
  requests[1].resolve('frame-2');
  await tick();
  assert.deepEqual(paints.at(-1), { frame: 'frame-2', point: { x: 70, y: 80 } });
  assert.equal(maximumConcurrent, 1);
  pump.dispose();
});

test('native magnifier disposal aborts active capture and ignores late pixels', async () => {
  const request = deferred(), paints = [];
  let signal;
  const pump = createMagnifierCapturePump((abortSignal) => {
    signal = abortSignal;
    return request.promise;
  }, (frame, point) => paints.push({ frame, point }), 0);
  pump.update({ x: 4, y: 8 });
  await tick();
  pump.dispose();
  assert.equal(signal.aborted, true);
  request.resolve('late-frame');
  await tick();
  assert.deepEqual(paints, []);
});

test('native magnifier cancel with a queued newer point never paints late pixels or restarts', async () => {
  const request = deferred(), paints = [];
  let captures = 0;
  const pump = createMagnifierCapturePump(() => { captures++; return request.promise; }, (frame, point) => paints.push({ frame, point }), 0);
  pump.update({ x: 4, y: 8 });
  await tick();
  pump.update({ x: 20, y: 30 });
  pump.dispose();
  request.resolve('late-frame');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(captures, 1);
  assert.deepEqual(paints, []);
});

test('native magnifier reports capture errors and retries until real pixels arrive', async () => {
  const paints = [], errors = [];
  let captures = 0;
  const pump = createMagnifierCapturePump(() => {
    captures++;
    return captures === 1 ? Promise.reject(new Error('PixelCopy failed')) : Promise.resolve('real-frame');
  }, (frame, point) => paints.push({ frame, point }), 0, (error) => errors.push(error.message), 10);
  pump.update({ x: 14, y: 28 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(errors, ['PixelCopy failed']);
  assert.equal(captures, 2);
  assert.deepEqual(paints, [{ frame: 'real-frame', point: { x: 14, y: 28 } }]);
  pump.dispose();
});

test('magnifier crop clamps its source window at map edges and preserves pointer centering', () => {
  assert.deepEqual(magnifierCropWindow({ x: 10, y: 48 }, { x: 0, y: 0, width: 60, height: 96 }), {
    source: { x: 0, y: 32, width: 26, height: 32 },
    destination: { x: 6 / 32, y: 0, width: 26 / 32, height: 1 },
  });
  assert.equal(magnifierCropWindow({ x: 101, y: 48 }, { x: 0, y: 0, width: 100, height: 96 }), null,
    'a pointer outside the captured ROI must leave the previous canvas pixels intact');
});

test('moving the pointer outside an in-flight ROI keeps old pixels until a fresh ROI arrives', async () => {
  const requests = [], paints = [];
  let latest = { x: 20, y: 40 };
  const roiAt = (point) => ({ x: point.x - 48, y: point.y - 48, width: 96, height: 96 });
  const pump = createMagnifierCapturePump(() => {
    const request = deferred();
    request.roi = roiAt(latest);
    requests.push(request);
    return request.promise;
  }, (frame, point) => {
    const window = magnifierCropWindow(point, frame.roi);
    if (window) paints.push({ frame: frame.id, point, window });
  }, 0);

  pump.update(latest);
  await tick();
  latest = { x: 220, y: 80 };
  pump.update(latest);
  requests[0].resolve({ id: 'old-roi', roi: requests[0].roi });
  await tick();
  assert.deepEqual(paints, [], 'old capture is not stretched around a pointer beyond its crop');
  assert.equal(requests.length, 2, 'the queued latest point starts a new region capture');
  requests[1].resolve({ id: 'new-roi', roi: requests[1].roi });
  await tick();
  assert.equal(paints.length, 1);
  assert.equal(paints[0].frame, 'new-roi');
  assert.deepEqual(paints[0].point, latest);
  pump.dispose();
});

test('PointMagnifier updates a live native observer instead of tearing it down on every move', async (t) => {
  const { parseHTML } = await import('linkedom');
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  await build({ entryPoints: ['modules/tracks/PointMagnifier.tsx'], outfile: '.openai/native-magnifier-test/PointMagnifier.js', bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PointMagnifier } = await import(`../.openai/native-magnifier-test/PointMagnifier.js?v=${Date.now()}`);
  const root = createRoot(document.getElementById('root'));
  const calls = [];
  const observe = (_canvas, point) => {
    calls.push(['subscribe', point]);
    const stop = () => calls.push(['unsubscribe']);
    stop.update = (next) => calls.push(['update', next]);
    return stop;
  };
  t.after(async () => {
    await React.act(async () => root.unmount());
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  const render = (point) => React.createElement(PointMagnifier, { point, width: 390, height: 857, observe });
  await React.act(async () => root.render(render({ x: 10, y: 20 })));
  await React.act(async () => root.render(render({ x: 30, y: 40 })));
  await React.act(async () => root.render(render({ x: 50, y: 60 })));
  assert.deepEqual(calls, [
    ['subscribe', { x: 10, y: 20 }],
    ['update', { x: 30, y: 40 }],
    ['update', { x: 50, y: 60 }],
  ]);
});

test('PointMagnifier keeps an outstanding native capture across parent rerenders with new inline observers', async (t) => {
  const { parseHTML } = await import('linkedom');
  const { window } = parseHTML('<html><body><div id="root"></div></body></html>');
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  await build({ entryPoints: ['modules/tracks/PointMagnifier.tsx'], outfile: '.openai/native-magnifier-test/PointMagnifier.js', bundle: true, format: 'esm', platform: 'node', packages: 'external', jsx: 'automatic' });
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PointMagnifier } = await import(`../.openai/native-magnifier-test/PointMagnifier.js?parent=${Date.now()}`);
  const root = createRoot(document.getElementById('root'));
  const request = deferred(), paints = [];
  let subscriptions = 0, unsubscriptions = 0;
  let mounted = true;
  const pump = createMagnifierCapturePump(() => request.promise, (frame, point) => paints.push({ frame, point }), 0);
  function Parent({ revision }) {
    const observe = (_canvas, point) => {
      subscriptions++;
      pump.update(point);
      const stop = () => { unsubscriptions++; pump.dispose(); };
      stop.update = (next) => pump.update(next);
      return stop;
    };
    return React.createElement(PointMagnifier, { point: { x: 12, y: 24 }, width: 390, height: 857, observe, 'data-revision': revision });
  }
  t.after(async () => {
    if (mounted) await React.act(async () => root.unmount());
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await React.act(async () => root.render(React.createElement(Parent, { revision: 1 })));
  await tick();
  await React.act(async () => root.render(React.createElement(Parent, { revision: 2 })));
  assert.equal(subscriptions, 1, 'a new inline wrapper does not restart the active native observer');
  assert.equal(unsubscriptions, 0, 'the active capture remains owned until the drawing component unmounts');
  request.resolve('completed-frame');
  await tick();
  assert.deepEqual(paints, [{ frame: 'completed-frame', point: { x: 12, y: 24 } }]);
  await React.act(async () => root.unmount());
  mounted = false;
  assert.equal(unsubscriptions, 1, 'actual unmount releases the native subscription');
});
