import assert from 'node:assert/strict';
import test from 'node:test';
import { sectionSettingsWithNativeNotes } from '../modules/map/native/sectionNotes.ts';
import { sectionKey } from '../modules/section/profileNotes.ts';

const settings = { enabled: true, altitude: 100, color: '#9de8c4', plane: { center: [103, 31], width: 1000, height: 500, heading: 0, tilt: 90 } };
const savedNotes = [{ id: 'note-a', name: '点A', note: '', fields: [], point: { u: 0, v: 0, local: [0, 0, 0], coordinates: [103, 31], altitude: 100, distance: 0 }, curveName: '地形', source: 'terrain', sampledAt: 1 }];

test('native section transport clones settings and injects saved notes for the matching section key', () => {
  const raw = JSON.stringify([{ settings: { ...settings }, notes: savedNotes, savedAt: 1 }]);
  const native = sectionSettingsWithNativeNotes(settings, raw);
  assert.deepEqual(native.notes, savedNotes);
  assert.equal(settings.notes, undefined);
  assert.notEqual(native, settings);
});

test('native section transport uses live preview notes and keeps saved sections isolated by sectionKey', () => {
  const otherSettings = { ...settings, altitude: 120 };
  const previewNotes = [{ ...savedNotes[0], id: 'preview-note' }];
  const nativePreview = sectionSettingsWithNativeNotes(settings, JSON.stringify([{ settings, notes: savedNotes, savedAt: 1 }]), { key: sectionKey(settings), notes: previewNotes });
  assert.deepEqual(nativePreview.notes, previewNotes);
  const nativeOther = sectionSettingsWithNativeNotes(otherSettings, JSON.stringify([{ settings, notes: savedNotes, savedAt: 1 }]), { key: sectionKey(settings), notes: previewNotes });
  assert.deepEqual(nativeOther.notes, []);
});

test('malformed saved-note storage stays excluded without mutating section settings', () => {
  const native = sectionSettingsWithNativeNotes(settings, '{broken');
  assert.deepEqual(native.notes, []);
  assert.equal(settings.notes, undefined);
});
