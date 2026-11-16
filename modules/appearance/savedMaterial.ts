import { THEME_KEY, type Appearance, type PaletteColor } from './theme.ts';

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

const materialColorSources: Record<PaletteColor, Record<string, string>> = {
  background: {
    'glass-surface': 'surface', 'material-panel': 'surface', 'material-favorites': 'surface',
    'material-toast': 'surface', 'material-topbar': 'surface', 'material-bottom': 'surface',
    'material-rail': 'surface', 'glass-border': 'glass-border', line: 'line',
  },
  button: { button: 'button', raised: 'raised', field: 'field', 'control-subtle': 'button' },
  accent: {
    accent: 'accent', active: 'active', selected: 'selected', 'switch-on': 'switch-on',
    'on-accent': 'on-accent', 'active-ink': 'active-ink', 'selected-ink': 'selected-ink',
  },
  foreground: {
    ink: 'ink', 'glass-ink': 'glass-ink', 'button-ink': 'button-ink', muted: 'muted',
    'glass-muted': 'glass-muted', close: 'close', 'glass-line': 'glass-line',
    'switch-off': 'switch-off', 'on-switch': 'on-switch', 'on-switch-off': 'on-switch-off',
  },
};

export function themeColorAlpha(value: string): number {
  return Number(value.match(/^rgba\([^)]*,\s*([\d.]+)\)$/)?.[1] ?? 1);
}

function withExistingAlpha(color: string, previous: string): string {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  const channels = hex ? hex.slice(1).map(channel => parseInt(channel, 16)) : rgb?.slice(1);
  return channels ? `rgba(${channels.join(',')},${themeColorAlpha(previous)})` : previous;
}

/** Recolor the saved material without replacing its opacity or shape. */
export function getRecoloredMaterialTokens(
  preset: SavedMaterial, theme: Record<string, string>, colors: readonly PaletteColor[],
): Record<string, string> {
  const tokens = getSavedMaterialTokens(preset);
  for (const color of colors) {
    for (const [target, source] of Object.entries(materialColorSources[color] ?? {})) {
      const key = `--ui-${target}`;
      const value = theme[`--ui-${source}`];
      if (value && tokens[key]) tokens[key] = withExistingAlpha(value, tokens[key]);
    }
  }
  return tokens;
}
