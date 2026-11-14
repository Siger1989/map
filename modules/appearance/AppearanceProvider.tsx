'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_APPEARANCE, parseAppearance, THEME_KEY, themeTokens, type Appearance } from './theme';
import './appearance.css';
import './inputFocus.css';
import './inputText.css';
import './scrollbars.css';
import './primaryActions.css';
import { useSpringInteractions } from '../ui/useSpringInteractions';
import { AppColorPicker } from './AppColorPicker';
import savedMaterialPreset from './savedMaterialPreset.json';
import { installMaterialRuntime } from './materialRuntime.js';
import { getPersonalMaterialTokensToRemove, getSavedMaterialTokens, initializeSavedMaterial, PERSONAL_MATERIAL_STATE_KEY, saveAppearanceAndDisableMaterial, setSavedMaterialEnabled, type SavedMaterial } from './savedMaterial';
const savedMaterial = savedMaterialPreset as SavedMaterial;
const Context = createContext<{ settings: Appearance; dark: boolean; save: (next: Appearance) => void; message: string; personalMaterial: boolean; applyPersonalMaterial: () => void } | null>(null);
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
  const dark = settings.mode === 'dark' || (settings.mode === 'system' && systemDark);
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.dataset.uiTheme = dark ? 'dark' : 'light';
    const computedTokens = themeTokens(settings[dark ? 'dark' : 'light']);
    Object.entries(computedTokens).forEach(([key,value]) => root.style.setProperty(key,value));
    if (personalMaterial) {
      Object.entries(getSavedMaterialTokens(savedMaterial)).forEach(([key,value]) => root.style.setProperty(key,value));
      root.dataset.uiPersonalMaterial = 'true';
    } else {
      // Recompute normal theme tokens first. Remove only preset-owned tokens the
      // regular theme does not define, so fresh base values are never erased.
      getPersonalMaterialTokensToRemove(savedMaterial,computedTokens).forEach(key => root.style.removeProperty(key));
      delete root.dataset.uiPersonalMaterial;
    }
  },[settings,dark,personalMaterial,ready]);
  const save = (next: Appearance) => {
    setSettings(next);
    setPersonalMaterial(false);
    try { saveAppearanceAndDisableMaterial(localStorage,next); setMessage('已保存，立即生效'); }
    catch { setMessage('当前已预览，存储不可用；重新打开后恢复默认'); }
  };
  const applyPersonalMaterial = () => {
    const next = parseAppearance(JSON.stringify(savedMaterial.appearance));
    setSettings(next);
    setPersonalMaterial(true);
    try { setSavedMaterialEnabled(localStorage,true,savedMaterial); setMessage('已应用我的调色'); }
    catch { setMessage('当前已预览，存储不可用；重新打开后恢复默认'); }
  };
  return <Context.Provider value={{settings,dark,save,message,personalMaterial,applyPersonalMaterial}}>{children}<AppColorPicker /></Context.Provider>;
}
export function useAppearance() {
  const value = useContext(Context);
  if (!value) throw new Error('AppearanceProvider missing');
  return value;
}
