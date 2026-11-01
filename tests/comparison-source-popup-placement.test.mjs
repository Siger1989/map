import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const helper = path.join(root, 'modules/mapComparison/sourcePopupPlacement.ts');

async function loadHelper() {
  const dir = await mkdtemp(path.join(tmpdir(), 'source-popup-placement-'));
  const outfile = path.join(dir, 'helper.mjs');
  await build({ entryPoints: [helper], outfile, bundle: true, format: 'esm', platform: 'node' });
  const url = pathToFileURL(outfile).href;
  const mod = await import(`${url}?t=${Date.now()}`);
  return { mod, dir };
}

test('source menu flips above a lower-pane trigger and stays within the safe viewport', async () => {
  const { mod, dir } = await loadHelper();
  try {
    const result = mod.sourcePopupPlacement({
      triggerTop: 706, triggerBottom: 734, safeTop: 56, safeBottom: 820,
      contentHeight: 490, preferredMaxHeight: 420,
    });
    assert.deepEqual(result, { side: 'above', maxHeight: 420 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('source menu uses the only available side and caps its scroll height to that viewport space', async () => {
  const { mod, dir } = await loadHelper();
  try {
    const result = mod.sourcePopupPlacement({
      triggerTop: 65, triggerBottom: 93, safeTop: 56, safeBottom: 150,
      contentHeight: 300, preferredMaxHeight: 250,
    });
    assert.deepEqual(result, { side: 'below', maxHeight: 55 });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
