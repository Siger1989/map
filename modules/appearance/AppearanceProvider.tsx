'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_APPEARANCE, parseAppearance, THEME_KEY, themeTokens, type Appearance, type PaletteColor } from './theme';
import './appearance.css';
import './inputFocus.css';
import './inputText.css';
import './scrollbars.css';
import './primaryActions.css';
import { useSpringInteractions } from '../ui/useSpringInteractions';
import { AppColorPicker } from './AppColorPicker';
import savedMaterialPreset from './savedMaterialPreset.json';
import { installMaterialRuntime } from './materialRuntime.js';
import { getPersonalMaterialTokensToRemove, getRecoloredMaterialTokens, initializeSavedMaterial, PERSONAL_MATERIAL_STATE_KEY, themeColorAlpha, type SavedMaterial } from './savedMaterial';
const savedMaterial = savedMaterialPreset as SavedMaterial;
const Context = createContext<{ settings: Appearance; dark: boolean; save: (next: Appearance, colors?: readonly PaletteColor[]) => void; message: string; usesSavedMaterial: boolean; personalMaterial: boolean; applyPersonalMaterial: () => void } | null>(null);
export function AppearanceProvider({children}: {children: ReactNode}) {
  useEffect(() => installMaterialRuntime(window), []);
  useSpringInteractions();
  const [settings,setSettings] = useState(DEFAULT_APPEARANCE);
  const [personalMaterial,setPersonalMaterial] = useState(false);
  const [systemDark,setSystemDark] = useState(false);
  const [ready,setReady] = useState(false), [message,setMessage] = useState('');
  useEffect(() => {
    try {
      // Preserve readable existing settings even if the migration cannot write.
      setSettings(parseAppearance(localStorage.getItem(THEME_KEY)));
      setPersonalMaterial(initializeSavedMaterial(localStorage, savedMaterial));
      setSettings(parseAppearance(localStorage.getItem(THEME_KEY)));
    } catch { /* Use default in restricted storage. */ }
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemDark(media.matches); sync(); setReady(true);
    const storage = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) setSettings(parseAppearance(event.newValue));
      if (event.key === PERSONAL_MATERIAL_STATE_KEY || event.key === null) {
        setPersonalMaterial(localStorage.getItem(PERSONAL_MATERIAL_STATE_KEY) === 'active');
      }
    };
    media.addEventListener('change',sync); window.addEventListener('storage',storage);
    return () => { media.removeEventListener('change',sync); window.removeEventListener('storage',storage); };
  },[]);
  const colorChange = useRef(false);
  const dark = settings.mode === 'dark' || (settings.mode === 'system' && systemDark);
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.dataset.uiTheme = dark ? 'dark' : 'light';
    const computedTokens = themeTokens(settings[dark ? 'dark' : 'light']);
    Object.entries(computedTokens).forEach(([key,value]) => root.style.setProperty(key,value));
    if (personalMaterial) {
      Object.entries(getRecoloredMaterialTokens(savedMaterial, computedTokens, settings.materialColors ?? [])).forEach(([key,value]) => root.style.setProperty(key,value));
      root.dataset.uiPersonalMaterial = 'true';
    } else {
      // Recompute normal theme tokens first. Remove only preset-owned tokens the
      // regular theme does not define, so fresh base values are never erased.
      getPersonalMaterialTokensToRemove(savedMaterial,computedTokens).forEach(key => root.style.removeProperty(key));
      delete root.dataset.uiPersonalMaterial;
    }
    if (colorChange.current) {
      colorChange.current = false;
      window.dispatchEvent(new Event('shantu-palette-change'));
    }
  },[settings,dark,personalMaterial,ready]);
  const save = (next: Appearance, colors: readonly PaletteColor[] = []) => {
    const updated = {
      ...next,
      materialColors: [...new Set([...(settings.materialColors ?? []), ...colors])],
    };
    if (!personalMaterial) {
      for (const scheme of ['light', 'dark'] as const) {
        updated[scheme] = {
          ...next[scheme],
          glassOpacity: themeColorAlpha(themeTokens(settings[scheme])['--ui-glass-surface']),
        };
      }
    }
    colorChange.current = colors.length > 0 || next.mode !== settings.mode;
    setSettings(updated);
    try { localStorage.setItem(THEME_KEY,JSON.stringify(updated)); setMessage('已保存，立即生效'); }
    catch { setMessage('当前已预览，存储不可用；重新打开后恢复默认'); }
  };
  const applyPersonalMaterial = () => {
    if (!personalMaterial) {
      const draft = savedMaterialPreset.draft;
      const colors = {
        accent: draft.accent.color, background: draft.glass.color,
        button: draft.button.color, foreground: draft.ink.color,
      };
      save({ ...settings, light: { ...settings.light, ...colors }, dark: { ...settings.dark, ...colors } },
        ['accent', 'background', 'button', 'foreground']);
      return;
    }
    const next = {
      ...settings,
      light: { ...settings.light, ...savedMaterial.appearance.light, contrast: settings.light.contrast },
      dark: { ...settings.dark, ...savedMaterial.appearance.dark, contrast: settings.dark.contrast },
      materialColors: [],
    };
    colorChange.current = true;
    setSettings(next);
    try { localStorage.setItem(THEME_KEY,JSON.stringify(next)); setMessage('已应用我的调色'); }
    catch { setMessage('当前已预览，存储不可用；重新打开后恢复默认'); }
  };
  return <Context.Provider value={{settings,dark,save,message,usesSavedMaterial:personalMaterial,personalMaterial:personalMaterial && !settings.materialColors?.length,applyPersonalMaterial}}>{children}<AppColorPicker /></Context.Provider>;
}
export function useAppearance() {
  const value = useContext(Context);
  if (!value) throw new Error('AppearanceProvider missing');
  return value;
}
