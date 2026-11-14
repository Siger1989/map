import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERIAL_SCHEMA, MATERIAL_TOKEN_NAMES, validateMaterial } from '../modules/appearance/materialRuntime.js';
test('shared material protocol preserves fractional RGB and alpha', () => {
  const payload = {schema:MATERIAL_SCHEMA,revision:1,tokens:{'--ui-button':'rgba(43.146,33.495,18.054,0.63)'}};
  assert.deepEqual(validateMaterial(payload),payload);
  assert.equal(MATERIAL_TOKEN_NAMES.length,40);
});
test('layout tokens accept bounded pixels and reject unsafe or unusable sizes', () => {
  const valid={schema:MATERIAL_SCHEMA,revision:2,tokens:{'--ui-search-width':'300px','--ui-search-padding':'10px','--ui-search-gap':'4px','--ui-search-row-height':'44px'}};
  assert.deepEqual(validateMaterial(valid),valid);
  for(const value of ['0px','27px','65px','44%','calc(44px + 1px)'])assert.throws(()=>validateMaterial({...valid,tokens:{'--ui-search-row-height':value}}));
});
test('shared material protocol rejects non-theme data and CSS injection', () => {
  for (const tokens of [{'--private-key':'secret'},{'--ui-button':'red;body{display:none}'},{'--ui-button':'url(https://example.com)'},{'--ui-button':42}])
    assert.throws(()=>validateMaterial({schema:MATERIAL_SCHEMA,revision:1,tokens}));
  assert.throws(()=>validateMaterial({schema:MATERIAL_SCHEMA,revision:-1,tokens:{}}));
});
