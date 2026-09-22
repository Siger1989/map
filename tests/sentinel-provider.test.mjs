import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LAYERS, applyLayerPatch } from '../modules/map/types.ts';
import { usesSentinel, usesTianditu } from '../modules/cartography/sentinel.ts';

test('a configured API key does not select Tianditu; legacy settings default to Sentinel', () => {
  const initial = {...DEFAULT_LAYERS, satellite:true};
  for (const settings of [initial, {...initial, satelliteProvider:undefined}]) {
    assert.equal(usesSentinel(settings), true);
    assert.equal(usesTianditu(settings, true), false);
  }
});
test('manual Tianditu and existing package selection remain explicit and reversible', () => {
  const tdt = applyLayerPatch(DEFAULT_LAYERS, {tiandituBase:'img'});
  assert.equal(usesTianditu(tdt, true), true);
  assert.equal(usesTianditu(tdt, false), false);
  assert.equal(usesSentinel(tdt), false);
  const sentinel = applyLayerPatch(tdt, {satellite:true, satelliteProvider:'sentinel'});
  assert.equal(usesSentinel(sentinel), true);
  assert.equal(usesTianditu(sentinel, true), false);
  assert.equal(usesSentinel({...sentinel, offlineBasemap:true}), false);
  assert.equal(usesSentinel({...sentinel, imageryMode:'latest'}), false);
});
