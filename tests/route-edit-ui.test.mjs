import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('route editing starts with free drawing and keeps both drawing modes available', async () => {
  const [tracks, editor] = await Promise.all([
    readFile(new URL('../modules/tracks/useManualTracks.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/tracks/RouteViews.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(tracks, /useState\(false\);\s*\n\s*const \[riverSnapping/);
  assert.match(editor, /aria-label="路线编辑方式"/);
  assert.match(editor, />\s*自由画线\s*</);
  assert.match(editor, />\s*道路吸附\s*</);
  assert.doesNotMatch(editor, /branch && \(\s*<button aria-pressed=\{roadSnapping\}/);
});
