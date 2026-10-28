import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskMigrationBackup, TASK_MIGRATION_FORMAT } from '../modules/dataTransfer/taskMigration.ts';

test('task migration exports unsaved drawing and pauses an active GPS checkpoint with a strict allowlist', () => {
  const draft = { id: 'draft-1', name: '河边草稿', segments: [[[10, 20], [10.1, 20.1]]], edgeColors: { '0:0': '#aabbcc' }, history: ['must not export'], kinds: ['points'] };
  const recording = { id: 'record-1', phase: 'recording', startedAt: 123, segments: [[{ coordinates: [11, 21], time: 124, accuracy: 5, altitude: null }]], error: 'private transient error', debug: 'excluded' };
  const result = createTaskMigrationBackup({ draft, recording, now: 456, fileReferences: [{ displayName: 'route.gpx', purpose: '需在新应用重新选择' }] });
  assert.equal(result.format, TASK_MIGRATION_FORMAT);
  assert.equal(result.draft.name, '河边草稿');
  assert.deepEqual(result.draft.segments, draft.segments);
  assert.equal('history' in result.draft, false);
  assert.equal(result.recording.phase, 'paused');
  assert.equal('error' in result.recording, false);
  assert.deepEqual(result.fileReferences, [{ displayName: 'route.gpx', purpose: '需在新应用重新选择' }]);
  assert.equal(JSON.stringify(result).includes('uri'), false);
});

test('task migration refuses empty work and invalid reselect references', () => {
  assert.throws(() => createTaskMigrationBackup({ draft: { segments: [], kinds: [], history: [], pointLine: null } }), /没有可迁移/);
  assert.throws(() => createTaskMigrationBackup({ draft: { segments: [[[0, 0]]], kinds: [], history: [], pointLine: null }, fileReferences: [{ displayName: '', purpose: 'reselect' }] }), /说明不完整/);
});
