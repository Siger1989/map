import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_APPEARANCE, PRESETS, THEME_KEY, parseAppearance, themeTokens } from '../modules/appearance/theme.ts';
import {
  getPersonalMaterialTokensToRemove,
  getSavedMaterialTokens,
  initializeSavedMaterial,
  PERSONAL_MATERIAL_BACKUP_KEY,
  PERSONAL_MATERIAL_STATE_KEY,
  saveAppearanceAndDisableMaterial,
  setSavedMaterialEnabled,
} from '../modules/appearance/savedMaterial.ts';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../modules/appearance/savedMaterialPreset.json', import.meta.url)), 'utf8'));

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

test('first migration backs up the exact prior appearance and preserves unrelated user data', () => {
  const storage = new MemoryStorage();
  const previous = JSON.stringify({ ...DEFAULT_APPEARANCE, mode: 'dark' });
  storage.setItem(THEME_KEY, previous);
  storage.setItem('shantu.businessdata.routes.v1', '[{"id":"keep-me"}]');

  assert.equal(initializeSavedMaterial(storage, preset), true);
  assert.deepEqual(JSON.parse(storage.getItem(PERSONAL_MATERIAL_BACKUP_KEY)), {
    existed: true,
    value: previous,
  });
  assert.deepEqual(parseAppearance(storage.getItem(THEME_KEY)), preset.appearance);
  assert.equal(storage.getItem(PERSONAL_MATERIAL_STATE_KEY), 'active');
  assert.equal(storage.getItem('shantu.businessdata.routes.v1'), '[{"id":"keep-me"}]');
});

test('opting out persists across reload and the saved material can be restored', () => {
  const storage = new MemoryStorage();
  const previous = JSON.stringify(DEFAULT_APPEARANCE);
  storage.setItem(THEME_KEY, previous);
  initializeSavedMaterial(storage, preset);
  const backup = storage.getItem(PERSONAL_MATERIAL_BACKUP_KEY);
  const chosen = { ...DEFAULT_APPEARANCE, mode: 'dark' };

  saveAppearanceAndDisableMaterial(storage, chosen);
  assert.equal(initializeSavedMaterial(storage, preset), false);
  assert.deepEqual(parseAppearance(storage.getItem(THEME_KEY)), chosen);
  assert.equal(storage.getItem(PERSONAL_MATERIAL_STATE_KEY), 'inactive');

  setSavedMaterialEnabled(storage, true, preset);
  assert.equal(initializeSavedMaterial(storage, preset), true);
  assert.deepEqual(parseAppearance(storage.getItem(THEME_KEY)), preset.appearance);
  assert.equal(storage.getItem(PERSONAL_MATERIAL_BACKUP_KEY), backup);
});

test('personal material token strings exactly match the saved preview values', () => {
  assert.deepEqual(getSavedMaterialTokens(preset), preset.tokens);
  assert.equal(preset.tokens['--ui-glass-surface'], 'rgba(255,255,255,0.03)');
  assert.equal(preset.tokens['--ui-radius-card'], '23px');
  assert.equal(preset.tokens['--ui-radius-control'], '20px');
});

test('disable removes only personal geometry tokens absent from freshly computed theme tokens', () => {
  const computed = themeTokens(preset.appearance.light);
  const removable = getPersonalMaterialTokensToRemove(preset, computed);
  assert.ok(removable.includes('--ui-radius-card'));
  assert.ok(removable.includes('--ui-radius-control'));
  assert.ok(!removable.includes('--ui-glass-surface'));
  assert.ok(removable.every(key => !(key in computed)));
});
