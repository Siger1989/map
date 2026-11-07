import { useEffect, useState } from 'react';
import { OFFLINE_MAP_KEY } from './tileCache';
import './offlineMapProgressPrompt.css';

const read = () => { try { return localStorage.getItem(OFFLINE_MAP_KEY) === 'true'; } catch { return false; } };
/** Make the deliberate, persistent network block visible and reversible on the map. */
export function OfflineModePrompt({ bottom = false }: { bottom?: boolean } = {}) {
  const [only, setOnly] = useState(read);
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = () => setOnly(read());
    window.addEventListener('shantu:offline-map-mode', sync); window.addEventListener('storage', sync);
    return () => { window.removeEventListener('shantu:offline-map-mode', sync); window.removeEventListener('storage', sync); };
  }, []);
  if (!only) return null;
  return <button className="offline-mode-recovery" data-bottom={bottom} aria-label="当前仅缓存浏览，恢复在线地图" onClick={() => {
    try {
      localStorage.setItem(OFFLINE_MAP_KEY, 'false');
      window.dispatchEvent(new Event('shantu:offline-map-mode'));
      setOnly(false); setError('');
    } catch { setError('设置未能保存，请重试'); }
  }}>{error || '仅缓存浏览 · 恢复在线地图'}</button>;
}
