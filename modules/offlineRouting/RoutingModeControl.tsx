import { useEffect, useState } from 'react';
import { routingMode, saveRoutingMode, type RoutingMode } from './preferences';
export function RoutingModeControl({ onOffline }: { onOffline?: () => void }) {
  const [mode, setMode] = useState<RoutingMode>('auto'),
    [error, setError] = useState('');
  useEffect(() => {
    const read = () => setMode(routingMode());
    read();
    window.addEventListener('shantu-routing-mode-changed', read);
    return () =>
      window.removeEventListener('shantu-routing-mode-changed', read);
  }, []);
  return (
    <label className="routing-mode-control">
      计算方式
      <select
        aria-label="路线计算方式"
        value={mode}
        onChange={(e) => {
          try {
            const value = e.target.value as RoutingMode;
            saveRoutingMode(value);
            setMode(value);
            setError('');
            if (value === 'offline') onOffline?.();
          } catch {
            setError('设置未保存');
          }
        }}
      >
        <option value="auto">优先离线，缺失时联网</option>
        <option value="offline">仅离线 · 步行</option>
        <option value="online">在线规划</option>
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
