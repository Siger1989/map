import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createPreviewWatchIgnore } from '../tools/previewWatchIgnore.mjs';

test('project source remains watchable in both the root checkout and a nested worktree', () => {
  const project = path.resolve('D:/weather-project');
  const nestedWorktree = path.join(project, '.openai', 'worktrees', 'feature-branch');

  assert.equal(createPreviewWatchIgnore(project)(path.join(project, 'modules', 'map', 'TerrainMap.tsx')), false);
  assert.equal(createPreviewWatchIgnore(nestedWorktree)(path.join(nestedWorktree, 'modules', 'map', 'TerrainMap.tsx')), false);
});

test('project output directories and the layout draft are ignored', () => {
  const project = path.resolve('D:/weather-project');
  const ignored = createPreviewWatchIgnore(project);
  for (const relative of [
    '.build/map.js', 'dist/index.html', 'APK/Shantu.apk', '.openai/worktrees/item/file.ts',
    'artifacts/screenshot.png', 'mobile/.build/map.js', 'mobile/dist/index.html',
    'modules/map/artifacts/profile.json', 'config/ui-layout-draft.json', 'config/ui-layout-draft.json.backup',
  ]) assert.equal(ignored(path.join(project, relative)), true, `${relative} should be ignored`);
  assert.equal(ignored(path.join(project, 'modules', 'map', 'TerrainMap.tsx')), false);
});

test('paths outside this project are ignored and cannot broaden its watch scope', () => {
  const project = path.resolve('D:/weather-project');
  const nestedWorktree = path.join(project, '.openai', 'worktrees', 'feature-branch');
  const ignored = createPreviewWatchIgnore(nestedWorktree);
  assert.equal(ignored(project), false, 'project parent must remain traversable');
  assert.equal(ignored(path.join(project, '.openai')), false, 'worktree ancestor must remain traversable');
  assert.equal(ignored(path.join(project, '.openai', 'worktrees')), false, 'worktree parent must remain traversable');
  assert.equal(ignored(path.join(project, '.openai', 'other-worktree', 'modules', 'file.ts')), true,
    'other worktree content must stay ignored');
  assert.equal(ignored(path.resolve(project, '.private', 'credentials.json')), true);
  assert.equal(ignored(path.resolve('D:/another-project/.private/data.json')), true);
});
