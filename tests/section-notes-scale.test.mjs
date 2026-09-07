import test from 'node:test';
import assert from 'node:assert/strict';
import {
  niceStep,
  metreTicks,
  SECTION_SIZES,
} from '../modules/section/scale.ts';
import { chartFrame } from '../modules/section/chartFrame.ts';
import {
  readSavedSections,
  sectionKey,
  updateSavedSection,
  noteDetails,
} from '../modules/section/profileNotes.ts';
import {
  moveProfileNote,
  sliderFraction,
  nearestContourFraction,
} from '../modules/section/notePosition.ts';
import { readSavedSection } from '../modules/section/savedSection.ts';
import { scaleLabel } from '../modules/section/scale.ts';
const settings = {
  enabled: true,
  altitude: 1000,
  color: '#ffffff',
  plane: {
    center: [103, 31],
    width: 500,
    height: 200,
    heading: 25,
    tilt: 70,
    roll: 15,
  },
};
const point = {
  u: 20,
  v: 10,
  local: [10, 20, 30],
  coordinates: [103.0001, 31.0001],
  altitude: 1010,
  distance: 50,
};
const note = {
  id: 'a',
  name: '岩层点',
  note: '露头\n砂岩',
  fields: [{ name: '厚度', value: '2.5', unit: 'm' }],
  point,
  curveName: '地形交线',
  source: 'terrain',
  sampledAt: 1000,
};
test('units and adjustable tick spacing preserve physical dimensions and note ownership', () => {
  const changed = { ...settings, scale: { unit: 'km', interval: 200 } };
  assert.equal(sectionKey(changed), sectionKey(settings));
  assert.equal(scaleLabel(200, 'km'), '0.2');
  assert.deepEqual(
    metreTicks(0, 1000, 4, 200).ticks,
    [0, 200, 400, 600, 800, 1000],
  );
  assert.equal(metreTicks(0, 200000, 4, 1).ticks.length <= 13, true);
  assert.equal(readSavedSection(JSON.stringify(changed)).scale.interval, 200);
});
test('saved plane survives visibility toggles; absence or invalid data never invents a plane', () => {
  assert.deepEqual(readSavedSection(JSON.stringify(settings)), settings);
  const hidden = { ...settings, enabled: false };
  assert.deepEqual(readSavedSection(JSON.stringify(hidden)), hidden);
  assert.equal(readSavedSection(null).plane, undefined);
  assert.throws(() => readSavedSection('{'));
  assert.throws(() =>
    readSavedSection(JSON.stringify({ ...settings, enabled: 'yes' })),
  );
});
test('moving one handle interpolates its own contour without changing names, fields or the other point', () => {
  const curve = {
    id: 'line',
    name: 'line',
    source: 'model',
    points: [point, { ...point, u: 120, local: [110, 20, 30] }],
    distances: [0, 100],
    length: 100,
    min: 0,
    max: 100,
    closed: false,
  };
  const original = structuredClone(note),
    moved = moveProfileNote(
      { ...note, color: '#ffcc77' },
      curve,
      0.75,
      settings,
      2000,
    );
  assert.equal(moved.fraction, 0.75);
  assert.equal(moved.point.distance, 75);
  assert.equal(moved.point.local[0], 85);
  assert.deepEqual(moved.fields, note.fields);
  assert.deepEqual(note, original);
  assert.equal(moved.color, '#ffcc77');
  assert.equal(sliderFraction(80, 100, 200), 0);
  assert.equal(sliderFraction(350, 100, 200), 1);
  assert.equal(
    nearestContourFraction(curve, 70, 10, (p) => [p.u, p.v]),
    0.5,
  );
});
test('metric rulers use bounded 1/2/5 steps for all presets and small/large custom sizes', () => {
  assert.deepEqual(SECTION_SIZES, [100, 200, 500, 1000, 2000, 5000, 10000]);
  for (const span of [0.1, 1, ...SECTION_SIZES, 200000]) {
    const { ticks, step } = metreTicks(-span / 2, span / 2, 4);
    assert.ok(ticks.length >= 2 && ticks.length <= 6);
    assert.ok(ticks.every((n) => n >= -span / 2 && n <= span / 2));
    assert.ok(
      ticks.every(
        (n, i) => !i || Math.abs(n - ticks[i - 1] - step) < step * 1e-8,
      ),
    );
  }
  assert.equal(niceStep(500, 5), 100);
  assert.equal(niceStep(900, 5), 200);
  assert.deepEqual(metreTicks(NaN, Infinity).ticks, []);
});
test('screen and export charts retain equal physical U/V scale and all saved points', () => {
  for (const [width, height] of [
    [300, 140],
    [1472, 660],
  ]) {
    const f = chartFrame(
      [
        {
          points: [
            { u: 0, v: 0 },
            { u: 100, v: 50 },
          ],
        },
      ],
      width,
      height,
      [{ u: -10, v: 80 }],
    );
    assert.equal(f.minU, -10);
    assert.equal(f.maxV, 80);
    assert.ok(
      Math.abs(
        f.x({ u: 1 }) - f.x({ u: 0 }) - (f.y({ v: 0 }) - f.y({ v: 1 })),
      ) < 1e-9,
    );
    assert.ok(
      f.x({ u: -10 }) >= f.left - 1e-8 && f.y({ v: 80 }) >= f.top - 1e-8,
    );
  }
});
test('measurement snapshots survive serialization and remain attached to the original plane', () => {
  const first = updateSavedSection([], settings, [note]);
  const moved = {
    ...settings,
    plane: { ...settings.plane, center: [104, 31] },
  };
  const records = updateSavedSection(first, moved, [{ ...note, id: 'b' }]);
  assert.equal(readSavedSections(JSON.stringify(records)).length, 2);
  assert.equal(
    sectionKey({ ...settings, enabled: false, color: '#aabbcc' }),
    sectionKey(settings),
  );
  assert.notEqual(sectionKey(moved), sectionKey(settings));
  assert.deepEqual(records[1].notes[0].point, point);
  const edited = updateSavedSection(records, settings, [
    { ...note, name: '修改名称' },
  ]);
  assert.equal(edited.length, 2);
  assert.equal(edited[0].notes[0].name, '修改名称');
  assert.equal(updateSavedSection(edited, settings, []).length, 1);
  const rows = noteDetails([note]).flat().join('\n');
  assert.match(rows, /103.0001000/);
  assert.match(rows, /1010.00 m/);
  assert.match(rows, /2.5 m/);
  assert.match(rows, /露头\n砂岩/);
});
test('corrupt/non-finite notes and malformed planes are rejected before storage replacement', () => {
  assert.deepEqual(readSavedSections(null), []);
  assert.throws(() => readSavedSections('{'));
  for (const invalid of [
    {},
    { ...settings, plane: { ...settings.plane, width: -1 } },
  ])
    assert.throws(() => updateSavedSection([], invalid, [note]));
  assert.throws(() =>
    updateSavedSection([], settings, [
      { ...note, point: { ...point, altitude: NaN } },
    ]),
  );
  assert.throws(() =>
    readSavedSections(
      JSON.stringify([
        { settings, savedAt: 1, notes: [{ ...note, fields: [{ name: 42 }] }] },
      ]),
    ),
  );
});
