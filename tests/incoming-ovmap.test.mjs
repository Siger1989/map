import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Android accepts OVMAP view and share intents and preserves .ovmap filenames', () => {
  const manifest = read('../mobile/android/AndroidManifest.xml');
  const incoming = read('../mobile/android/src/com/guanyun/weather/IncomingRoutes.java');
  const filters = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map(m => m[1]);
  const view = filters.find(filter => filter.includes('android.intent.action.VIEW'));
  const send = filters.find(filter => filter.includes('android.intent.action.SEND'));
  for (const filter of [view, send]) {
    assert.ok(filter, 'expected Android incoming-file intent filter');
    assert.match(filter, /android:mimeType="application\/x-ovmap"/);
    assert.match(filter, /android:mimeType="application\/vnd\.ovmap"/);
  }
  assert.match(view, /android:scheme="content"/);
  assert.match(incoming, /ovobj\|ovmap/);
  assert.match(incoming, /filename = "图源\.ovmap"/);
});

test('OVMAP handoff selects map-source flow and reuses explicit import review', () => {
  const hook = read('../modules/dataTransfer/useIncomingRoute.ts');
  const panel = read('../modules/mapSources/MapSourcesPanel.tsx');
  assert.match(hook, /if \(\/\\\.ovmap\$\/i\.test\(file\.name\)\)/);
  assert.match(hook, /setMapSource\(file\)/);
  assert.match(hook, /native\.incomingRouteDismiss\(token\)/);
  assert.match(panel, /incomingFile\?: File \| null/);
  assert.match(panel, /if \(!incomingFile \|\| !sources\.ready\) return/);
  assert.match(panel, /file\(incomingFile\)/);
  assert.match(panel, /parseOvmap\(/);
  assert.match(panel, /preview\(result\.drafts\.map/);
  assert.match(panel, /existingMapIndexes/);
});
