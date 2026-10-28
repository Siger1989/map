import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeMapBridgeClient, NativeMapBridgeError, getSharedNativeMapClient } from '../modules/map/native/client.ts';

class FakeWindow extends EventTarget {
  location = { origin: 'https://appassets.androidplatform.net' };
  ShantuNativeMap;
  sent = [];
  constructor(handler = () => {}) {
    super();
    this.ShantuNativeMap = { postMessage: (raw) => { const message = JSON.parse(raw); this.sent.push(message); handler(message, this); } };
  }
  host(message) {
    const event = Object.assign(new Event('shantu:native-map'), { detail: message });
    this.dispatchEvent(event);
  }
}

function ok(win, request, payload = {}, sessionId = 'session-a') {
  win.host({ version: 1, sessionId, mapId: request.mapId, requestId: request.requestId, type: 'result', payload });
}

test('hello creates one trusted session and publishes local ready event', async () => {
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: { geometry: { status: 'ready' } } });
  });
  let ready;
  win.addEventListener('shantu:native-map-ready', (event) => { ready = event.detail; });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
  const hello = await client.connect('main');
  assert.equal(client.isReady, true);
  assert.equal(client.sessionId, 'session-a');
  assert.deepEqual(hello.capabilities.geometry, { status: 'ready' });
  assert.deepEqual(ready, { sessionId: 'session-a' });
  assert.deepEqual(win.sent[0], {
    version: 1,
    requestId: win.sent[0].requestId,
    mapId: 'main',
    command: 'hello',
    payload: { protocolVersion: 1 },
  });
  client.dispose();
});

test('origin allowlist and absent bridge block instead of silently falling back', () => {
  const win = new FakeWindow();
  assert.throws(() => new NativeMapBridgeClient({ window: win, trustedOrigins: ['http://localhost'] }), (error) => error.code === 'untrusted-origin');
  win.ShantuNativeMap = undefined;
  assert.throws(() => new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] }), (error) => error.code === 'unavailable');
});

test('shared singleton reuses one hello session across primary and comparison maps', async () => {
  let hellos = 0;
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') { hellos++; ok(target, message, { sessionId: 'one-session', capabilities: {} }, 'one-session'); }
  });
  const options = { window: win, trustedOrigins: [win.location.origin] };
  const first = getSharedNativeMapClient(options), second = getSharedNativeMapClient(options);
  assert.equal(first, second);
  await first.connect('main');
  await second.connect('aux-1');
  assert.equal(hellos, 1);
  assert.equal(first.sessionId, 'one-session');
  first.dispose();
});

test('create, viewport and dispose are scoped to the requested map id', async () => {
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: {} });
    else if (message.command === 'create') ok(target, message, { created: true });
    else if (message.command === 'mapViewport') ok(target, message, { applied: true });
    else if (message.command === 'dispose') ok(target, message, { disposed: true });
  });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
  await client.connect();
  await client.createMap('aux-1');
  await client.setMapViewport('aux-1', { cssRect: { x: 200, y: 50, width: 100, height: 80 }, devicePixelRatio: 2, clientViewportWidth: 400 });
  assert.equal(await client.disposeMap('aux-1'), true);
  assert.equal(await client.disposeMap('aux-1'), false);
  assert.deepEqual(win.sent.filter((message) => ['create', 'mapViewport', 'dispose'].includes(message.command)).map(({ command, mapId }) => [command, mapId]), [
    ['create', 'aux-1'], ['mapViewport', 'aux-1'], ['dispose', 'aux-1'],
  ]);
  client.dispose();
});

test('owner-scoped create recovers a host map whose original acknowledgement timed out', async () => {
  let createCount = 0;
  let late;
  const hostOwners = new Map();
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: {} });
    else if (message.command === 'create') {
      createCount++;
      const owner = message.payload;
      const existing = hostOwners.get(message.mapId);
      if (existing && existing.ownerToken === owner.ownerToken && existing.ownerGeneration === owner.ownerGeneration) {
        ok(target, message, { created: true, existing: true, ...existing });
      } else {
        hostOwners.set(message.mapId, { ownerToken: owner.ownerToken, ownerGeneration: owner.ownerGeneration });
        if (createCount === 1) late = message;
        else ok(target, message, { created: true, ...hostOwners.get(message.mapId) });
      }
    } else if (message.command === 'dispose') {
      const owner = hostOwners.get(message.mapId);
      if (owner?.ownerToken === message.payload.ownerToken && owner.ownerGeneration === message.payload.ownerGeneration) hostOwners.delete(message.mapId);
      ok(target, message, { disposed: !hostOwners.has(message.mapId), ownerMismatch: hostOwners.has(message.mapId) });
    }
  });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin], timeoutMs: 35 });
  await client.connect();
  const owner = { ownerToken: 'map-main-owner-a', ownerGeneration: 7 };
  await assert.rejects(client.createMap('main', owner), (error) => error.code === 'timeout');
  assert.ok(late);
  ok(win, late, { created: true, ...owner }); // A late reply after the request timed out must be ignored.
  await client.createMap('main', owner);
  assert.equal(createCount, 2, 'retry reaches the host so it can return its existing instance');
  assert.equal(win.sent.filter((message) => message.command === 'hello').length, 1, 'recovery must not reset the shared session');
  const before = createCount;
  await client.createMap('main', owner);
  assert.equal(createCount, before, 'a confirmed owner does not allocate a second native map');
  await client.disposeMap('main', owner);
  assert.equal(hostOwners.has('main'), false);
  client.dispose();
});

test('same-owner concurrent creates coalesce while primary and auxiliary owners stay isolated', async () => {
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: {} });
    else if (message.command === 'create') setTimeout(() => ok(target, message, { created: true }), 5);
    else if (message.command === 'dispose') ok(target, message, { disposed: true });
  });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
  await client.connect();
  const primary = { ownerToken: 'primary-owner', ownerGeneration: 1 };
  const auxiliary = { ownerToken: 'auxiliary-owner', ownerGeneration: 2 };
  await Promise.all([client.createMap('main', primary), client.createMap('main', primary)]);
  await client.createMap('aux-1', auxiliary);
  assert.equal(win.sent.filter((message) => message.command === 'create' && message.mapId === 'main').length, 1);
  assert.equal(win.sent.filter((message) => message.command === 'create' && message.mapId === 'aux-1').length, 1);
  await client.disposeMap('main', primary);
  assert.equal(client.cameraFrame('aux-1'), null);
  assert.equal(win.sent.filter((message) => message.command === 'dispose').length, 1);
  client.dispose();
});

test('a newer map owner replaces only its map and an old owner cannot dispose the replacement', async () => {
  const owners = new Map();
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: {} });
    else if (message.command === 'create') {
      const owner = { ownerToken: message.payload.ownerToken, ownerGeneration: message.payload.ownerGeneration };
      const existing = owners.get(message.mapId);
      if (!existing || owner.ownerGeneration > existing.ownerGeneration) owners.set(message.mapId, owner);
      if (owners.get(message.mapId).ownerToken !== owner.ownerToken) {
        target.host({ version: 1, sessionId: 'session-a', mapId: message.mapId, requestId: message.requestId, type: 'error', payload: { code: 'stale_map_owner', message: 'stale' } });
      } else ok(target, message, { created: true, ...owner });
    } else if (message.command === 'dispose') {
      const current = owners.get(message.mapId);
      const match = current?.ownerToken === message.payload.ownerToken && current?.ownerGeneration === message.payload.ownerGeneration;
      if (match) owners.delete(message.mapId);
      ok(target, message, { disposed: match, ownerMismatch: !match });
    }
  });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
  await client.connect();
  const oldOwner = { ownerToken: 'old-main', ownerGeneration: 1 };
  const newOwner = { ownerToken: 'new-main', ownerGeneration: 2 };
  const auxOwner = { ownerToken: 'aux', ownerGeneration: 3 };
  await client.createMap('main', oldOwner);
  await client.createMap('aux-1', auxOwner);
  await client.createMap('main', newOwner);
  assert.deepEqual(owners.get('main'), newOwner);
  assert.deepEqual(owners.get('aux-1'), auxOwner);
  assert.equal(await client.disposeMap('main', { ...oldOwner }), false);
  assert.deepEqual(owners.get('main'), newOwner);
  await client.disposeMap('main', newOwner);
  assert.equal(owners.has('main'), false);
  assert.deepEqual(owners.get('aux-1'), auxOwner);
  client.dispose();
});

test('owner replacement clears only that map caches and a late old dispose ACK cannot erase new-owner state', async () => {
  const owners = new Map();
  let delayedOldDispose;
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: {} });
    else if (message.command === 'create') {
      const requested = { ownerToken: message.payload.ownerToken, ownerGeneration: message.payload.ownerGeneration };
      const current = owners.get(message.mapId);
      if (!current || requested.ownerGeneration > current.ownerGeneration) owners.set(message.mapId, requested);
      if (owners.get(message.mapId).ownerToken !== requested.ownerToken) {
        target.host({ version: 1, sessionId: 'session-a', mapId: message.mapId, requestId: message.requestId, type: 'error', payload: { code: 'stale_map_owner', message: 'stale' } });
      } else ok(target, message, { created: true, ...requested });
    } else if (message.command === 'dispose' && message.mapId === 'main' && message.payload.ownerToken === 'old-main') {
      const current = owners.get(message.mapId);
      const disposed = current?.ownerToken === message.payload.ownerToken && current?.ownerGeneration === message.payload.ownerGeneration;
      if (disposed) owners.delete(message.mapId);
      delayedOldDispose = () => ok(target, message, { disposed, ownerMismatch: !disposed });
    } else if (message.command === 'dispose') {
      const current = owners.get(message.mapId);
      const matches = current?.ownerToken === message.payload.ownerToken && current?.ownerGeneration === message.payload.ownerGeneration;
      if (matches) owners.delete(message.mapId);
      ok(target, message, { disposed: matches, ownerMismatch: !matches });
    } else if (message.command === 'renderState') ok(target, message, { applied: true, revision: message.payload.revision });
  });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
  await client.connect();
  const oldOwner = { ownerToken: 'old-main', ownerGeneration: 1 };
  const newOwner = { ownerToken: 'new-main', ownerGeneration: 2 };
  const auxOwner = { ownerToken: 'auxiliary', ownerGeneration: 1 };
  await client.createMap('main', oldOwner);
  await client.createMap('aux-1', auxOwner);
  const state = (revision) => ({ revision, settings: {}, mapViewport: { cssRect: { x: 0, y: 0, width: 100, height: 80 }, devicePixelRatio: 2, clientViewportWidth: 100 } });
  const frame = (sequence) => ({ sequence, camera: {}, viewProjection: Array(16).fill(0), inverseViewProjection: Array(16).fill(0), viewport: { x: 0, y: 0, width: 100, height: 100 }, cssScale: 2, clipDepth: 'minusOneToOne', demRevision: 1, capturedAt: sequence });
  const tile = (id) => ({ id, west: 0, south: 0, east: 1, north: 1, width: 2, height: 2, heights: [1, 2, 3, 4] });
  for (const [mapId, revision] of [['main', 9], ['aux-1', 5]]) {
    await client.setRenderState(mapId, state(revision));
    win.host({ version: 1, sessionId: 'session-a', mapId, type: 'event', payload: { name: 'renderFrame', value: frame(revision) } });
    win.host({ version: 1, sessionId: 'session-a', mapId, type: 'event', payload: { name: 'demCache', value: { revision, tiles: [tile(mapId)] } } });
  }
  assert.equal(client.cameraFrame('main').sequence, 9);
  assert.equal(client.demCache('main').revision, 9);
  assert.equal(client.cameraFrame('aux-1').sequence, 5);
  assert.equal(client.demCache('aux-1').revision, 5);

  const oldDispose = client.disposeMap('main', oldOwner);
  await client.createMap('main', newOwner);
  assert.equal(client.cameraFrame('main'), null);
  assert.equal(client.demCache('main').revision, -1);
  assert.equal(client.cameraFrame('aux-1').sequence, 5);
  assert.equal(client.demCache('aux-1').revision, 5);

  assert.deepEqual(await client.setRenderState('main', state(1)), { applied: true, revision: 1 });
  win.host({ version: 1, sessionId: 'session-a', mapId: 'main', type: 'event', payload: { name: 'renderFrame', value: frame(1) } });
  win.host({ version: 1, sessionId: 'session-a', mapId: 'main', type: 'event', payload: { name: 'demCache', value: { revision: 1, tiles: [tile('new-main')] } } });
  assert.equal(typeof delayedOldDispose, 'function');
  delayedOldDispose();
  assert.equal(await oldDispose, true, 'the delayed ACK reports the old entry disposal even though it must not mutate new-owner caches');

  assert.equal(owners.get('main').ownerToken, 'new-main');
  assert.equal(client.cameraFrame('main').sequence, 1);
  assert.equal(client.demCache('main').revision, 1);
  assert.deepEqual(await client.setRenderState('main', state(1)), { applied: false, revision: 1, reason: 'stale_local_revision' });
  assert.equal(client.cameraFrame('aux-1').sequence, 5);
  assert.equal(client.demCache('aux-1').revision, 5);
  client.dispose();
});

test('requests resolve by requestId and mapId; subscriptions and render revisions are map scoped', async () => {
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: {} });
    else if (message.command === 'ping') ok(target, message, { value: message.mapId });
    else if (message.command === 'renderState') ok(target, message, { applied: true, revision: message.payload.revision });
  });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
  await client.connect();
  assert.deepEqual(await client.request('main', 'ping'), { value: 'main' });
  let camera;
  client.subscribe('aux-1', 'cameraFrame', (value) => { camera = value; });
  const frame = { sequence: 4, camera: {}, viewProjection: Array(16).fill(0), inverseViewProjection: Array(16).fill(0), viewport: { x: 0, y: 0, width: 100, height: 100 }, cssScale: 2, clipDepth: 'minusOneToOne', demRevision: 0, capturedAt: 1 };
  win.host({ version: 1, sessionId: 'session-a', mapId: 'aux-1', type: 'event', payload: { name: 'cameraFrame', value: frame } });
  assert.equal(camera.sequence, 4);
  assert.equal(client.cameraFrame('aux-1').sequence, 4);
  assert.equal(client.cameraFrame('main'), null);
  const state = { revision: 2, settings: {}, mapViewport: { cssRect: { x: 0, y: 0, width: 100, height: 80 }, devicePixelRatio: 2, clientViewportWidth: 100 } };
  assert.deepEqual(await client.setRenderState('main', state), { applied: true, revision: 2 });
  assert.deepEqual(await client.setRenderState('main', { ...state, revision: 2 }), { applied: false, revision: 2, reason: 'stale_local_revision' });
  assert.deepEqual(await client.setRenderState('aux-1', state), { applied: true, revision: 2 });
  const renderMessages = win.sent.filter((message) => message.command === 'renderState');
  assert.deepEqual(renderMessages.map(({ mapId, payload }) => [mapId, payload.revision]), [['main', 2], ['aux-1', 2]]);
  client.dispose();
});

test('abort and timeout reject locally and send cancel; stale session replies cannot resolve', async () => {
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: {} });
  });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin], timeoutMs: 80 });
  await client.connect();
  const abort = new AbortController();
  const cancelled = client.request('main', 'slow', {}, { signal: abort.signal });
  const slowRequest = win.sent.findLast((message) => message.command === 'slow');
  abort.abort();
  await assert.rejects(cancelled, (error) => error.code === 'cancelled');
  assert.ok(win.sent.some((message) => message.command === 'cancel' && message.payload.targetRequestId === slowRequest.requestId));
  await assert.rejects(client.request('main', 'timeout', {}, { timeoutMs: 50 }), (error) => error.code === 'timeout');

  const pending = client.request('aux-1', 'stale');
  const staleRequest = win.sent.findLast((message) => message.command === 'stale');
  client.dispose();
  win.host({ version: 1, sessionId: 'session-a', mapId: 'aux-1', requestId: staleRequest.requestId, type: 'result', payload: { value: true } });
  await assert.rejects(pending, (error) => error.code === 'disposed');
});

test('render state rejects binary data rather than silently dropping a local source', async () => {
  const win = new FakeWindow((message, target) => {
    if (message.command === 'hello') ok(target, message, { sessionId: 'session-a', capabilities: {} });
  });
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
  await client.connect();
  assert.throws(() => client.setRenderState('main', { revision: 1, mapSource: { blob: new Blob(['map']) } }), (error) => error.code === 'binary-transfer-required');
  client.dispose();
});
