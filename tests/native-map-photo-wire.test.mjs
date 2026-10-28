import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeMapBridgeClient } from '../modules/map/native/client.ts';
import { serializeNativeMapPhoto } from '../modules/map/native/photoWire.ts';

class FakeWindow extends EventTarget {
  location = { origin: 'https://appassets.androidplatform.net' };
  sent = [];
  ShantuNativeMap = { postMessage: (raw) => {
    const message = JSON.parse(raw);
    this.sent.push(message);
    if (message.command === 'hello') this.reply(message, { sessionId: 'photo-wire-session', capabilities: {} }, 'photo-wire-session');
    else if (message.command === 'renderState') this.reply(message, { applied: true, revision: message.payload.revision });
  } };
  reply(request, payload, sessionId = 'photo-wire-session') {
    this.dispatchEvent(Object.assign(new Event('shantu:native-map'), {
      detail: { version: 1, sessionId, mapId: request.mapId, requestId: request.requestId, type: 'result', payload },
    }));
  }
}

test('stored photo detail Blob is excluded from the real native renderState wire DTO', async () => {
  const detail = new Blob(['full-resolution photo bytes'], { type: 'image/jpeg' });
  const preview = new Blob(['map thumbnail bytes'], { type: 'image/webp' });
  const photo = {
    id: 'photo-1', name: 'trail.jpg', trackId: 'trip-1', trackName: 'Trip', time: 1,
    coordinates: [103, 31], kind: 'point', preview, detail, title: 'Summit', url: 'blob:photo-viewer',
  };
  const wirePhoto = serializeNativeMapPhoto(photo, 'dGh1bWJuYWls', ['photo-1']);
  assert.equal(photo.detail, detail, 'serializing for the map must leave the original viewer photo intact');
  assert.equal('detail' in wirePhoto, false);
  assert.equal('preview' in wirePhoto, false);
  assert.equal('url' in wirePhoto, false);
  assert.equal(wirePhoto.previewBase64, 'dGh1bWJuYWls');

  const win = new FakeWindow();
  const client = new NativeMapBridgeClient({ window: win, trustedOrigins: [win.location.origin] });
  await client.connect();
  const result = await client.setRenderState('main', { revision: 1, photos: [wirePhoto] });
  assert.deepEqual(result, { applied: true, revision: 1 });
  const sentState = win.sent.find((message) => message.command === 'renderState').payload;
  assert.equal('detail' in sentState.photos[0], false);
  assert.equal(sentState.photos[0].previewBase64, 'dGh1bWJuYWls');

  assert.throws(() => client.setRenderState('main', { revision: 2, photos: [{ ...wirePhoto, detail }] }),
    (error) => error.code === 'binary-transfer-required');
  client.dispose();
});
