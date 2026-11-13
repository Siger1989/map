import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedMaterialInk } from '../mobile/phonePreviewMaterialContrast.js';

test('gold selected fills use the user dark button text instead of gold-on-gold',()=>{
  assert.equal(selectedMaterialInk([231,185,44,1],[51,59,41,.35],[255,206,71,1],[61,43,22,1]),'rgba(61,43,22,1)');
});
test('readable user text is preserved for cream and dark selections',()=>{
  assert.equal(selectedMaterialInk([254,241,214,1],[255,250,241,.6],[65,45,30,1],[16,36,60,1]),'rgba(65,45,30,1)');
  assert.equal(selectedMaterialInk([35,48,45,1],[20,30,25,.8],[255,206,71,1],[61,43,22,1]),'rgba(255,206,71,1)');
});
test('foreground transparency participates in contrast instead of making a faint label seem readable',()=>{
  assert.equal(selectedMaterialInk([231,185,44,1],[51,59,41,.35],[0,0,0,.05],[61,43,22,1]),'rgba(61,43,22,1)');
});
