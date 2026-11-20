import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultJourneySkyLayers as defaults, parseJourneySkyLayers } from '../modules/sky/journeySkyLayerSettings.ts';
import { constellationOptions } from '../modules/sky/constellations.ts';

test('journey sky layer preferences use defaults for missing or invalid storage', () => {
  for (const encoded of [null, '{}', 'null', 'false', '[]', '#invalid']) {
    assert.deepEqual(parseJourneySkyLayers(encoded),defaults);
  }
  assert.deepEqual(parseJourneySkyLayers('{"moon":0,"sun":false,"constellationId":"removed"}'),{...defaults,sun:false});
});

test('all four switches and a known individual constellation survive independently', () => {
  const id=constellationOptions[0].id;
  for (let bit=0;bit<16;bit++) {
    const saved={sun:!!(bit&1),moon:!!(bit&2),constellations:!!(bit&4),milkyWay:!!(bit&8),constellationId:id};
    assert.deepEqual(parseJourneySkyLayers(JSON.stringify(saved)),saved);
  }
  assert.equal(parseJourneySkyLayers('{"constellations":true,"constellationId":"all"}').constellationId,'all');
});
