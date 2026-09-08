import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionKey } from '../modules/section/profileNotes.ts';
import {
  readSectionObjects,
  replaceSection,
  validateSectionObjects,
  SECTION_OBJECTS_KEY,
} from '../modules/section/sectionObjects.ts';
import { SAVED_SECTION_KEY } from '../modules/section/savedSection.ts';
import { collectData, mergeData } from '../modules/outdoor/exchange.ts';
const settings = {
  enabled: true,
  color: '#9de8c4',
  altitude: 1600,
  plane: {
    center: [103.7, 31.1],
    width: 5000,
    height: 4000,
    heading: 25,
    tilt: 0,
  },
};
test('legacy section migrates once; an explicitly empty new collection never resurrects it', () => {
  const legacy = JSON.stringify(settings),
    migrated = readSectionObjects(null, legacy);
  assert.equal(migrated.length, 1);
  assert.deepEqual(migrated[0].settings, settings);
  assert.deepEqual(readSectionObjects('[]', legacy), []);
  assert.throws(() => readSectionObjects('{bad', legacy));
});
test('changing one saved section preserves the other geometry, identity and visibility after reload', () => {
  const original = readSectionObjects(null, JSON.stringify(settings));
  const both = [
    ...original,
    {
      id: 'second',
      name: '剖面2',
      settings: {
        ...settings,
        enabled: false,
        plane: { ...settings.plane, center: [104, 31.2] },
      },
    },
  ];
  const next = replaceSection(both, 'legacy-section', {
    ...settings,
    altitude: 1800,
    plane: { ...settings.plane, heading: 90 },
  });
  const reloaded = readSectionObjects(JSON.stringify(next));
  assert.deepEqual(reloaded[1], both[1]);
  assert.equal(reloaded[0].settings.altitude, 1800);
  assert.equal(original[0].settings.altitude, 1600);
  assert.throws(() => validateSectionObjects([...both, both[0]]));
  assert.throws(() =>
    replaceSection(both, 'second', { ...settings, altitude: Infinity }),
  );
});
test('backup merges multiple sections with new IDs for conflicts and rejects overflow before writes', () => {
  const saved = new Map([[SAVED_SECTION_KEY, JSON.stringify(settings)]]);
  const storage = {
    getItem: (k) => saved.get(k) ?? null,
    setItem: (k, v) => saved.set(k, v),
    removeItem: (k) => saved.delete(k),
  };
  const before = collectData(storage);
  assert.equal(before.sections.length, 1);
  const incoming = {
    format: 'guanyun-backup',
    version: 1,
    tracks: [],
    annotations: [],
    favorites: [],
    sections: [
      {
        id: 'legacy-section',
        name: '另一剖面',
        settings: { ...settings, altitude: 2000 },
      },
    ],
  };
  mergeData(incoming, storage);
  const next = readSectionObjects(saved.get(SECTION_OBJECTS_KEY));
  assert.equal(next.length, 2);
  assert.equal(next[0].settings.altitude, 1600);
  assert.notEqual(next[1].id, next[0].id);
  const raw = saved.get(SECTION_OBJECTS_KEY);
  assert.throws(() =>
    mergeData(
      {
        ...incoming,
        sections: Array.from({ length: 20 }, (_, i) => ({
          ...incoming.sections[0],
          id: `import-${i}`,
        })),
      },
      storage,
    ),
  );
  assert.equal(saved.get(SECTION_OBJECTS_KEY), raw);
  assert.equal(saved.get(SAVED_SECTION_KEY), JSON.stringify(settings));
});

test('identically placed new sections keep separate measurement keys while legacy notes retain their key', () => {
  assert.notEqual(
    sectionKey({ ...settings, objectId: 'one' }),
    sectionKey({ ...settings, objectId: 'two' }),
  );
  assert.equal(
    sectionKey(settings),
    sectionKey({ ...settings, objectId: undefined }),
  );
});
