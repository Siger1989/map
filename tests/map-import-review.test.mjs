import test from 'node:test';
import assert from 'node:assert/strict';
import { existingMapIndexes } from '../modules/mapSources/importReview.ts';
import { parseMapConfig } from '../modules/mapSources/online.ts';

const draft = parseMapConfig('https://tiles.example.invalid/{z}/{x}/{y}.png')[0];
test('repeat imports skip existing configurations and duplicates without merging different credentials or grids', () => {
  const saved = [{ ...draft, id: 'existing', bytes: 123 }];
  const second = { ...draft, tiles: [draft.tiles[0] + '?key=fictional-two'] };
  const changedGrid = { ...draft, scheme: 'tms' };
  assert.deepEqual([...existingMapIndexes([draft, second, { ...second, name: 'renamed' }, changedGrid], saved)], [0, 2]);
  assert.deepEqual(saved[0].tiles, draft.tiles);
});
test('offline maps are not merged based on matching names or metadata', () => {
  const offline = { ...draft, kind: 'mbtiles', tiles: undefined };
  assert.equal(existingMapIndexes([offline, offline], []).size, 0);
});
test('duplicate identity includes coordinate datum and the OVMAP layer stack', () => {
  const layered = {
    ...draft,
    ovmap: { layers: [{ tiles: ['https://base.example.invalid/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 1, maxzoom: 18 }] },
  };
  const sameLayersRenamed = { ...layered, name: 'Different display name' };
  const otherDatum = { ...layered, datum: 'gcj02' };
  const otherLayer = {
    ...layered,
    ovmap: { layers: [{ tiles: ['https://overlay.example.invalid/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 1, maxzoom: 18 }] },
  };

  assert.deepEqual([...existingMapIndexes([layered, sameLayersRenamed, otherDatum, otherLayer], [])], [1]);
  assert.deepEqual([...existingMapIndexes([layered, otherDatum], [{ ...layered, id: 'saved', bytes: 1 }])], [0]);
});
test('a source collection supports up to 100 definitions and rejects larger batches', () => {
  const collection = Array.from({ length: 43 }, (_, i) => ({ ...draft, name: `Map ${i}` }));
  assert.equal(parseMapConfig(JSON.stringify(collection)).length, 43);
  assert.throws(() => parseMapConfig(JSON.stringify(Array(101).fill(draft))), /100/);
});
