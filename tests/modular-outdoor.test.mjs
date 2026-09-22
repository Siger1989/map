import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFix, emptyRecording } from '../modules/outdoor/recording.ts';
import { nativeRecordingSnapshot } from '../modules/outdoor/nativeRecordingSnapshot.ts';
import { composeTrackOverlay } from '../modules/workbench/trackOverlay.ts';
import { startRouteEdit } from '../modules/tracks/routeEdit.ts';
import { normalizeTrackStyle } from '../modules/tracks/style.ts';
import {
  analyzeRoute,
  metricLineParts,
} from '../modules/routeAnalysis/metrics.ts';
import { parseFiles } from '../modules/dataTransfer/batchImport.ts';
import { metresBetween } from '../modules/navigation/types.ts';
import {
  acceptsSample,
  DEFAULT_SAMPLING,
  SAMPLING_PRESETS,
  validSampling,
} from '../modules/outdoor/samplingPolicy.ts';

const time = 1800000000000;
const fix = (lng, timestamp = time) => ({
  coordinates: [lng, 30],
  time: timestamp,
  altitude: 1000,
  accuracy: 5,
});
const track = (id, start = 103) => ({
  id,
  name: id,
  createdAt: time,
  segments: [
    [
      [start, 30],
      [start + 0.001, 30],
    ],
  ],
  source: 'manual',
});
const transfer = (tracks) => ({
  format: 'guanyun-backup',
  version: 1,
  tracks,
  annotations: [],
  favorites: [],
});

test('sampling policies preserve accuracy checks, bound custom settings and keep distance-only static', () => {
  for (const [mode, preset] of Object.entries(SAMPLING_PRESETS))
    assert.equal(validSampling({ ...DEFAULT_SAMPLING, ...preset, mode }), true);
  assert.equal(
    validSampling({ ...DEFAULT_SAMPLING, intervalSeconds: NaN }),
    false,
  );
  assert.equal(
    validSampling({ ...DEFAULT_SAMPLING, distanceMetres: '5' }),
    false,
  );
  assert.equal(acceptsSample(4, 29, DEFAULT_SAMPLING), false);
  assert.equal(acceptsSample(4, 30, DEFAULT_SAMPLING), true);
  assert.equal(
    acceptsSample(4, 80, { ...DEFAULT_SAMPLING, distanceOnly: true }),
    false,
  );
  assert.equal(
    acceptsSample(5, 4, { ...DEFAULT_SAMPLING, distanceOnly: true }),
    true,
  );
  const current = {
    ...emptyRecording(),
    phase: 'recording',
    segments: [[fix(103)]],
  };
  assert.equal(
    appendFix(
      current,
      { ...fix(103.001, time + 10000), accuracy: 70 },
      time + 10000,
      20,
      DEFAULT_SAMPLING,
    ),
    current,
  );
});

test('append reuses completed segments, rejects without allocation, and never changes the checkpoint', () => {
  const old = {
    ...emptyRecording(),
    phase: 'recording',
    segments: [[fix(103)], [fix(104)]],
  };
  const raw = JSON.stringify(old);
  assert.equal(appendFix(old, fix(104, time + 1000), time + 1000), old);
  const next = appendFix(old, fix(104.001, time + 10000), time + 10000);
  assert.equal(next.segments[0], old.segments[0]);
  assert.notEqual(next.segments[1], old.segments[1]);
  assert.equal(next.segments[1].length, 2);
  assert.equal(JSON.stringify(old), raw);
  const gap = appendFix(old, fix(104.001, time + 121000), time + 121000);
  assert.equal(gap.segments[1], old.segments[1]);
  assert.equal(gap.segments.length, 3);
});

test('native quality and phase updates retain geometry, but changed coordinates and heights do not', () => {
  const read = nativeRecordingSnapshot();
  const record = { ...emptyRecording(), id: 'r', segments: [[fix(103)]] };
  const a = read(JSON.stringify(record));
  const b = read(
    JSON.stringify({ ...record, phase: 'paused', error: 'signal' }),
  );
  assert.equal(a.segments, b.segments);
  assert.equal(b.error, 'signal');
  const c = read(
    JSON.stringify({ ...record, segments: [[{ ...fix(103), altitude: 900 }]] }),
  );
  assert.notEqual(c.segments, b.segments);
});

test('overlay replaces edited sources once while retaining live recording and untouched routes', () => {
  const a = track('a'),
    b = track('b'),
    c = track('c'),
    live = track('live-recording');
  const session = { ...startRouteEdit(a), sources: [a, b] };
  const input = {
    saved: [a, b, c],
    draft: [],
    session,
    recording: live,
    visible: true,
    style: normalizeTrackStyle(),
    nodes: [],
    drawing: false,
    snapTargets: true,
  };
  const result = composeTrackOverlay(input);
  assert.deepEqual(
    result.saved.map((t) => t.id),
    ['c', 'a', 'live-recording'],
  );
  assert.equal(result.saved[0], c);
  assert.equal(result.snapTargets, true);
  assert.equal(input.saved.length, 3);
  const plain = composeTrackOverlay({
    ...input,
    session: null,
    recording: null,
  });
  assert.equal(plain.saved, input.saved);
});

test('speed analysis excludes missing, backward and paused timestamps; repeated traversals retain their own color', () => {
  const a = [103, 30],
    b = [103.001, 30];
  const d = metresBetween(a, b);
  const measured = {
    segments: [[a, b, a]],
    samples: [
      [
        { time, altitude: 0 },
        { time: time + (d / 2) * 1000, altitude: 0 },
        { time: time + (d / 2 + d) * 1000, altitude: 0 },
      ],
    ],
  };
  const parts = metricLineParts(measured, 'speed');
  assert.equal(parts.length, 2);
  assert.equal(parts[0].color, '#ed782a');
  assert.equal(parts[1].color, '#60a7ad');
  measured.samples[0][1].time = time - 1;
  measured.samples[0][2].time = time + 121000;
  assert.deepEqual(analyzeRoute(measured).speeds, [[null, null]]);
  assert.equal(analyzeRoute({ segments: [[a, b]] }).maximumSpeedKmh, null);
});

test('a steady 25 percent grade yields a 25 percent 50m window and one steep section', () => {
  const line = Array.from({ length: 11 }, (_, i) => [103 + i * 0.00012, 30]);
  let distance = 0;
  const samples = line.map((point, i) => {
    if (i) distance += metresBetween(line[i - 1], point);
    return { altitude: 1000 + distance * 0.25, time: time + i * 10000 };
  });
  const result = analyzeRoute({ segments: [line], samples: [samples] });
  assert.ok(Math.abs(result.maximumSlopePercent - 25) < 1e-8);
  assert.ok(Math.abs(result.steepest50mPercent - 25) < 1e-8);
  assert.equal(result.steepSections, 1);
  samples[5].altitude = null;
  const missing = analyzeRoute({ segments: [line], samples: [samples] });
  assert.equal(missing.steepest50mPercent, null);
  assert.equal(missing.slopes[0][4], null);
  assert.equal(missing.slopes[0][5], null);
});

test('batch import remaps colliding route ids without touching localStorage or emitting data events', async () => {
  const oldWindow = globalThis.window;
  globalThis.window = {
    dispatchEvent() {
      assert.fail('preview must not emit persisted-data event');
    },
  };
  try {
    const files = [new File(['a'], 'a.json'), new File(['b'], 'b.json')];
    const result = await parseFiles(files, async (f) =>
      transfer([track('same', f.name === 'a.json' ? 103 : 105)]),
    );
    assert.equal(result.data.tracks.length, 2);
    assert.equal(new Set(result.data.tracks.map((t) => t.id)).size, 2);
    assert.equal(result.files.length, 2);
    await assert.rejects(
      parseFiles(files, async (f) => {
        if (f.name === 'b.json') throw Error('invalid geometry');
        return transfer([track('same')]);
      }),
      /b.json.*本批未导入/,
    );
    await assert.rejects(parseFiles(Array(11).fill(files[0])), /1–10/);
  } finally {
    globalThis.window = oldWindow;
  }
});
