'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_APPEARANCE, parseAppearance, THEME_KEY, themeTokens, type Appearance } from './theme';
import './appearance.css';
const Context = createContext<{ settings: Appearance; dark: boolean; save: (next: Appearance) => void; message: string } | null>(null);
export function AppearanceProvider({children}: {children: ReactNode}) {
  const [settings,setSettings] = useState(DEFAULT_APPEARANCE);
  const [systemDark,setSystemDark] = useState(false);
  const [ready,setReady] = useState(false), [message,setMessage] = useState('');
  useEffect(() => {
    try { setSettings(parseAppearance(localStorage.getItem(THEME_KEY))); } catch { /* Use default in restricted storage. */ }
    const media = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemDark(media.matches); sync(); setReady(true);
    const storage = (event: StorageEvent) => { if(event.key === THEME_KEY || event.key === null) setSettings(parseAppearance(event.newValue)); };
    media.addEventListener('change',sync); window.addEventListener('storage',storage);
    return () => { media.removeEventListener('change',sync); window.removeEventListener('storage',storage); };
  },[]);
  const dark = settings.mode === 'dark' || (settings.mode === 'system' && systemDark);
  useEffect(() => {
    if (!ready) return;
    const root = document.documentElement;
    root.dataset.uiTheme = dark ? 'dark' : 'light';
    Object.entries(themeTokens(settings[dark ? 'dark' : 'light'])).forEach(([key,value]) => root.style.setProperty(key,value));
  },[settings,dark,ready]);
  const save = (next: Appearance) => {
    setSettings(next);
    try { localStorage.setItem(THEME_KEY,JSON.stringify(next)); setMessage('已保存，立即生效'); }
    catch { setMessage('当前已预览，存储不可用；重新打开后恢复默认'); }
  };
  return <Context.Provider value={{settings,dark,save,message}}>{children}</Context.Provider>;
}
export function useAppearance() {
  const value = useContext(Context);
  if (!value) throw new Error('AppearanceProvider missing');
  return value;
}
