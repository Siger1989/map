import { useEffect, useState } from 'react';
import { browseCacheStats, clearBrowseCache } from './browseCache';
import { BROWSE_CACHE_CLEARED, readBrowseCacheSettings, saveBrowseCacheSettings } from './browseCachePreferences';
import './browseCache.css';

export function BrowseCacheSettings() {
  const [settings, setSettings] = useState(readBrowseCacheSettings);
  const [summary, setSummary] = useState('正在读取自动缓存…');
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => browseCacheStats().then(s => setSummary(
    `${(s.bytes / 1048576).toFixed(1)} / ${Math.round(s.limitBytes / 1048576)} MB · ${s.count} 张 · 沿线 ${s.routeCount} 张`,
  )).catch(() => setSummary('当前环境无法读取自动缓存'));
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, []);
  function update(next: typeof settings) {
    try { saveBrowseCacheSettings(next); setSettings(next); setMessage('设置已保存'); void refresh(); }
    catch { setMessage('设置未能保存'); }
  }
  async function clear() {
    setBusy(true);
    // Cancel idle warmups before clearing; old network responses cannot refill the store.
    window.dispatchEvent(new Event(BROWSE_CACHE_CLEARED));
    try { await clearBrowseCache(); await refresh(); setConfirm(false); setMessage('自动缓存已清理，离线包和轨迹保留'); }
    catch { setMessage('自动缓存清理失败，请重试'); }
    finally { setBusy(false); }
  }
  return <section className="browse-cache-settings" aria-label="自动地图缓存">
    <label><input type="checkbox" checked={settings.enabled} onChange={e => update({ ...settings, enabled: e.target.checked })} />边看边缓存</label>
    <label>优先缓存路线两侧各 <select aria-label="路线自动缓存范围" value={settings.bufferKm} onChange={e => update({ ...settings, bufferKm: Number(e.target.value) })}>
      <option value={0.5}>500 米</option><option value={1}>1 公里</option><option value={2}>2 公里</option>
    </select></label>
    <small>{summary}</small>
    <small>选中路线后，停稳时逐步缓存当前图源与级别附近瓦片；满额先清理非沿线旧缓存。</small>
    <div className="outdoor-actions">{confirm ? <>
      <button disabled={busy} onClick={() => void clear()}>{busy ? '清理中…' : '确认清理自动缓存'}</button>
      <button disabled={busy} onClick={() => setConfirm(false)}>取消</button>
    </> : <button onClick={() => setConfirm(true)}>清理自动缓存</button>}</div>
    {confirm && <small>只清理浏览时生成的缓存，保留主动下载的离线包。</small>}
    {message && <small role="status">{message}</small>}
  </section>;
}
