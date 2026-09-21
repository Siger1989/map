import { useEffect, useState } from 'react';
import { OFFLINE_MAP_KEY, offlineMapOnly } from './tileCache';
export function OfflineMapSettings({ onOpenMap }: { onOpenMap: () => void }) {
  const [only, setOnly] = useState(false),
    [storage, setStorage] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    setOnly(offlineMapOnly());
    void navigator.storage
      ?.estimate?.()
      .then((s) =>
        setStorage(
          `浏览器存储：${((s.usage ?? 0) / 1048576).toFixed(0)} / ${((s.quota ?? 0) / 1048576).toFixed(0)} MB`,
        ),
      );
  }, []);
  return (
    <section className="offline-map-settings" aria-label="离线地图设置">
      <label>
        <input
          type="checkbox"
          checked={only}
          onChange={(e) => {
            try {
              localStorage.setItem(OFFLINE_MAP_KEY, String(e.target.checked));
              setOnly(e.target.checked);
              if (e.target.checked) onOpenMap();
              window.dispatchEvent(new Event('shantu:offline-map-mode'));
              setMessage('已切换；移动或缩放地图检查缓存范围');
            } catch {
              setMessage('离线设置未保存');
            }
          }}
        />
        地图仅使用已缓存数据
      </label>
      <button
        onClick={() =>
          void (async () => {
            const persisted = await navigator.storage?.persist?.();
            setMessage(
              persisted
                ? '已申请持久存储，减少系统自动清理'
                : '当前环境未授予持久存储，请保留离线路网导出文件',
            );
          })().catch(() => setMessage('持久存储申请失败'))
        }
      >
        申请保留离线缓存
      </button>
      <small>{storage}</small>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
