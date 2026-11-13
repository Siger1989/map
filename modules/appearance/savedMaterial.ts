import { THEME_KEY, type Appearance } from './theme.ts';

export const PERSONAL_MATERIAL_STATE_KEY = 'shantu.appearance.personal-material.v1';
export const PERSONAL_MATERIAL_BACKUP_KEY = `${THEME_KEY}.before-personal-material.v1`;

export type SavedMaterial = {
  appearance: Appearance;
  tokens: Record<string, string>;
};

export type AppearanceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Apply the saved material once, keeping an exact copy of the prior appearance value. */
export function initializeSavedMaterial(storage: AppearanceStorage, preset: SavedMaterial): boolean {
  const state = storage.getItem(PERSONAL_MATERIAL_STATE_KEY);
  if (state !== null) return state === 'active';

  const previous = storage.getItem(THEME_KEY);
  if (storage.getItem(PERSONAL_MATERIAL_BACKUP_KEY) === null) {
    storage.setItem(PERSONAL_MATERIAL_BACKUP_KEY, JSON.stringify({
      existed: previous !== null,
      value: previous,
    }));
  }
  storage.setItem(THEME_KEY, JSON.stringify(preset.appearance));
  storage.setItem(PERSONAL_MATERIAL_STATE_KEY, 'active');
  return true;
}

export function setSavedMaterialEnabled(
  storage: AppearanceStorage,
  enabled: boolean,
  preset: SavedMaterial,
): void {
  storage.setItem(PERSONAL_MATERIAL_STATE_KEY, enabled ? 'active' : 'inactive');
  if (enabled) storage.setItem(THEME_KEY, JSON.stringify(preset.appearance));
}

export function saveAppearanceAndDisableMaterial(
  storage: AppearanceStorage,
  appearance: Appearance,
): void {
  storage.setItem(PERSONAL_MATERIAL_STATE_KEY, 'inactive');
  storage.setItem(THEME_KEY, JSON.stringify(appearance));
}

export function getSavedMaterialTokens(preset: SavedMaterial): Record<string, string> {
  return { ...preset.tokens };
}

export function getPersonalMaterialTokensToRemove(
  preset: SavedMaterial,
  recomputedThemeTokens: Record<string, string>,
): string[] {
  return Object.keys(preset.tokens).filter(key => !(key in recomputedThemeTokens));
}
