import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preferredCamera,
  openCamera,
  stopCamera,
  cameraError,
} from '../modules/mapSources/camera.ts';

test('prefer labeled rear wide over telephoto, preserve opaque choice and allow explicit lens', () => {
  const devices = [
    { deviceId: 'front', label: 'Front camera' },
    { deviceId: 'tele', label: 'Back telephoto' },
    { deviceId: 'wide', label: 'Back wide camera' },
  ];
  assert.equal(preferredCamera(devices, 'tele'), 'wide');
  assert.equal(
    preferredCamera(
      [
        { deviceId: 'a', label: 'camera 1' },
        { deviceId: 'b', label: 'camera 2' },
      ],
      'b',
    ),
    'b',
  );
});
function mediaFixture() {
  const opened = [],
    constraints = [],
    stopped = [];
  return {
    opened,
    constraints,
    stopped,
    media: {
      async getUserMedia(options) {
        assert.equal(options.audio, false);
        const id = options.video.deviceId?.exact ?? 'tele';
        opened.push(id);
        const track = {
          stop() {
            stopped.push(id);
          },
          getSettings: () => ({ deviceId: id }),
          getCapabilities: () => ({
            zoom: { min: 1, max: 10, step: 0.1 },
            focusMode: ['continuous'],
          }),
          async applyConstraints(c) {
            constraints.push(c);
          },
        };
        return { getTracks: () => [track], getVideoTracks: () => [track] };
      },
      async enumerateDevices() {
        return [
          { kind: 'videoinput', deviceId: 'tele', label: 'back telephoto' },
          { kind: 'videoinput', deviceId: 'wide', label: 'back wide' },
        ];
      },
    },
  };
}
test('release old lens before switching, reset zoom and respect manual choice', async () => {
  const f = mediaFixture();
  const result = await openCamera(f.media, '', () => true);
  assert.deepEqual(f.opened, ['tele', 'wide']);
  assert.deepEqual(f.stopped, ['tele']);
  assert.equal(result.deviceId, 'wide');
  assert.equal(f.constraints[0].advanced[0].zoom, 1);
  stopCamera(result.stream);
  assert.deepEqual(f.stopped, ['tele', 'wide']);
  const explicit = mediaFixture();
  await openCamera(explicit.media, 'tele', () => true);
  assert.deepEqual(explicit.opened, ['tele']);
});
test('closing during permission or enumeration releases late stream; permission failures remain actionable', async () => {
  const f = mediaFixture();
  await assert.rejects(
    openCamera(f.media, '', () => false),
    { name: 'AbortError' },
  );
  assert.deepEqual(f.stopped, ['tele']);
  const delayed = mediaFixture();
  let active = true;
  delayed.media.enumerateDevices = async () => {
    active = false;
    return [];
  };
  await assert.rejects(
    openCamera(delayed.media, '', () => active),
    { name: 'AbortError' },
  );
  assert.ok(delayed.stopped.includes('tele'));
  assert.match(
    cameraError(new DOMException('denied', 'NotAllowedError')),
    /权限/,
  );
});
