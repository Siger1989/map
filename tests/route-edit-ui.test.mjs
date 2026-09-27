import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('route editing starts without network snapping and exposes road and river toggles', async () => {
  const [tracks, editor] = await Promise.all([
    readFile(new URL('../modules/tracks/useManualTracks.ts', import.meta.url), 'utf8'),
    readFile(new URL('../modules/tracks/RouteViews.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(tracks, /useState\(false\);\s*\n\s*const \[riverSnapping/);
  assert.match(editor, /aria-label="路线编辑方式"/);
  assert.match(editor, />\s*道路吸附\s*</);
  assert.match(editor, />\s*河道吸附\s*</);
  assert.doesNotMatch(editor, />\s*自由画线\s*</);
  assert.match(editor, /aria-pressed=\{roadSnapping\} onClick=\{onRoadSnapping\}/);
  assert.match(editor, /aria-pressed=\{riverSnapping\} onClick=\{onRiverSnapping\}/);
  assert.doesNotMatch(editor, /branch && \(\s*<button aria-pressed=\{roadSnapping\}/);
});
