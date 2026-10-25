import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliverMacFile,
  configureMacRecording,
  isMacNativeSupported,
  macClipboardWrite,
  macShareText,
  subscribeMacState,
} from '../modules/platform/macNative.ts';
import { nativeOfflineRead, readNativeOfflineState, nativeOfflineHas, nativeOfflineAvailableBytes, nativeOfflineVerify, nativeOfflineRemove } from '../modules/outdoor/nativeOffline.ts';

test('Mac capability requires version 1 and listens to pushed snapshots', () => {
  const previous = globalThis.window;
  try {
    globalThis.window = {};
    assert.equal(isMacNativeSupported(), false);
    const fakeWindow = new EventTarget();
    fakeWindow.ShantuMac = { version: 1, snapshot: { location: { fix: true } }, request: async () => null };
    globalThis.window = fakeWindow;
    assert.equal(isMacNativeSupported(), true);
    let observed;
    const stop = subscribeMacState(value => { observed = value; });
    globalThis.window.dispatchEvent(new Event('shantu-mac-state'));
    stop();
    assert.deepEqual(observed, { location: { fix: true } });
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('Mac file delivery sends bounded chunks and waits for actual finish result', async () => {
  const previous = globalThis.window;
  const calls = [];
  try {
    globalThis.window = { ShantuMac: { version: 1, request: async (action, args) => {
      calls.push([action, args]);
      if (action === 'files.begin') return 'token-1';
      if (action === 'files.append') return args.offset + atob(args.base64).length;
      if (action === 'files.finish') return args.share ? 'shared' : 'saved';
      return true;
    } } };
    const input = new File([new Uint8Array(600_000).map((_, index) => index % 251)], 'route.bin');
    assert.equal(await deliverMacFile(input, false), 'saved');
    const chunks = calls.filter(([action]) => action === 'files.append');
    assert.equal(chunks.length, 3);
    assert.deepEqual(chunks.map(([, args]) => args.offset), [0, 262144, 524288]);
    assert.ok(chunks.every(([, args]) => atob(args.base64).length <= 262144));
    assert.equal(calls.at(-1)[0], 'files.finish');
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('Mac file cancellation cancels the native task and rejects with AbortError', async () => {
  const previous = globalThis.window;
  const calls = [];
  const controller = new AbortController();
  try {
    globalThis.window = { ShantuMac: { version: 1, request: async (action, args) => {
      calls.push(action);
      if (action === 'files.begin') return 'token-2';
      if (action === 'files.append') { controller.abort(); return args.offset + atob(args.base64).length; }
      return true;
    } } };
    await assert.rejects(deliverMacFile(new File(['x'.repeat(300_000)], 'photo.jpg'), true, controller.signal), { name: 'AbortError' });
    assert.ok(calls.includes('files.cancel'));
    assert.ok(!calls.includes('files.finish'));
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('Mac share and clipboard return native completion values', async () => {
  const previous = globalThis.window;
  const calls = [];
  try {
    globalThis.window = { ShantuMac: { version: 1, request: async (action, args) => {
      calls.push([action, args]);
      if (action === 'share.text') return 'shared';
      if (action === 'clipboard.write') return true;
      return null;
    } } };
    assert.equal(await macShareText('place text'), 'shared');
    assert.equal(await macClipboardWrite('coordinate'), true);
    assert.deepEqual(calls.map(([action]) => action), ['share.text', 'clipboard.write']);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('Mac offline cache awaits native operations and returns tile bytes directly', async () => {
  const previous = globalThis.window;
  const calls = [];
  try {
    globalThis.window = { ShantuMac: { version: 1, snapshot: { offline: { id: 'cached-1', state: 'downloading' } }, request: async (action, args) => {
      calls.push([action, args]);
      if (action === 'offline.state') return { id: 'cached-1', done: 1, total: 2, state: 'downloading' };
      if (action === 'offline.read') return { base64: btoa('tile-bytes'), mime: 'image/png' };
      if (action === 'offline.has') return true;
      if (action === 'offline.availableBytes') return 123456;
      if (action === 'offline.verify') return { id: 'cached-1', done: 2, total: 2, state: 'complete' };
      if (action === 'offline.remove') return true;
      return null;
    } } };
    assert.deepEqual(await readNativeOfflineState(), { id: 'cached-1', done: 1, total: 2, state: 'downloading' });
    assert.equal(await nativeOfflineHas('https://tiles.example/1/2/3'), true);
    const response = await nativeOfflineRead('https://tiles.example/1/2/3');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(await response.text(), 'tile-bytes');
    assert.equal(await nativeOfflineAvailableBytes(), 123456);
    assert.equal((await nativeOfflineVerify('cached-1')).state, 'complete');
    assert.equal(await nativeOfflineRemove('cached-1'), true);
    assert.ok(calls.every(([action]) => action.startsWith('offline.')));
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

test('Mac recording configuration uses persisted values and serializes field updates', async () => {
  const previous = globalThis.window;
  const sampling = { mode: 'standard', intervalSeconds: 2, distanceMetres: 5, stationarySeconds: 10, adaptive: true, distanceOnly: false, recordOnNavigation: false };
  let config = { maximumAccuracy: 20, sampling: { ...sampling } };
  try {
    globalThis.window = { ShantuMac: { version: 1, request: async (action, args) => {
      if (action === 'record.state') return structuredClone(config);
      if (action === 'record.configure') { config = structuredClone(args); return structuredClone(config); }
      return null;
    } } };
    await Promise.all([
      configureMacRecording({ maximumAccuracy: 10 }),
      configureMacRecording({ sampling: { ...sampling, mode: 'accuracy', intervalSeconds: 1 } }),
    ]);
    assert.equal(config.maximumAccuracy, 10);
    assert.equal(config.sampling.mode, 'accuracy');
    assert.equal(config.sampling.intervalSeconds, 1);
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
