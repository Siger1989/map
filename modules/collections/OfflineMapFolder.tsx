import { OfflineProgress } from '../outdoor/OfflineProgress';
import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  MoreHorizontal,
} from 'lucide-react';
import type { useOffline } from '../outdoor/useOffline';
import type { TripPackage } from '../outdoor/offline';
import { canDownloadTrip, TIANDITU_OFFLINE_DISABLED } from '../outdoor/offlineDownloadPolicy';
import './offlineMaps.css';

/** A view of the existing cache index, never a second copy of map data. */
export function OfflineMapFolder({
  offline,
  query = '',
  onOpen,
  onDownload,
}: {
  offline: ReturnType<typeof useOffline>;
  query?: string;
  onOpen: (trip: TripPackage) => void;
  onDownload: () => void;
}) {
  const [expanded, setExpanded] = useState(true),
    [active, setActive] = useState<string | null>(null),
    [removing, setRemoving] = useState<string | null>(null);
  const packages = offline.packages.filter((p) =>
    `${p.name} ${p.provider === 'tianditu' ? '天地图' : '开源地图'}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  if (query.trim() && !packages.length) return null;
  return (
    <section className="offline-map-folder" aria-label="收藏的离线地图">
      <button
        className="offline-map-folder-heading"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <Folder size={16} />
        <strong>离线地图</strong>
        <span>{packages.length} 项</span>
      </button>
      {expanded && (
        <div className="offline-map-folder-content">
          {packages.map((p) => (
            <article key={p.id} className="offline-map-entry">
              <div className="offline-map-entry-row">
                <button
                  className="offline-map-open"
                  aria-label={`打开离线地图：${p.name}`}
                  onClick={() => onOpen(p)}
                >
                  <strong>{p.name}</strong>
                  <small>
                    {p.complete ? '已缓存' : '未完成'} ·{' '}
                    {p.provider === 'tianditu' ? '天地图' : '开源地图'} ·{' '}
                    {p.zoom ?? 14}级 · {(p.bytes / 1048576).toFixed(1)} MB
                  </small>
                </button>
                <button
                  aria-label={`管理离线地图：${p.name}`}
                  aria-expanded={active === p.id}
                  onClick={() => {
                    setActive(active === p.id ? null : p.id);
                    setRemoving(null);
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
              <OfflineProgress trip={p} />
              {active === p.id && (
                <div className="offline-map-entry-tools">
                  <small>
                    {p.done}/{p.urls.length} 项
                    {p.bufferKm ? ` · 路线两侧各 ${p.bufferKm} 公里` : ''} ·{' '}
                    {new Date(p.createdAt).toLocaleDateString()}
                  </small>
                  {removing === p.id ? (
                    <>
                      <span>移除此离线包？原路线不会删除。</span>
                      <div>
                        <button
                          disabled={offline.removing?.includes(p.id)}
                          onClick={() => void offline.remove(p)}
                        >
                          移除缓存
                        </button>
                        <button onClick={() => setRemoving(null)}>取消</button>
                      </div>
                    </>
                  ) : (
                    <div>
                      <button
                        disabled={offline.busy || !canDownloadTrip(p)}
                        title={!canDownloadTrip(p) ? TIANDITU_OFFLINE_DISABLED : undefined}
                        onClick={() => void offline.resume(p)}
                      >
                        {canDownloadTrip(p) ? '继续 / 补齐' : '天地图下载已暂停'}
                      </button>
                      <button
                        disabled={offline.busy}
                        onClick={() => void offline.verify(p)}
                      >
                        检查
                      </button>
                      <button
                        disabled={offline.removing?.includes(p.id)}
                        onClick={() => setRemoving(p.id)}
                      >
                        移除
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
          {!packages.length && (
            <p>尚未缓存地图。可在路线页点“缓存当前路线”。</p>
          )}
          <div className="offline-map-folder-actions">
            <button onClick={onDownload}>
              <Download size={15} />
              缓存当前地图
            </button>
            {offline.busy && <button onClick={offline.pause}>暂停下载</button>}
          </div>
          {offline.message && <p role="status">{offline.message}</p>}
        </div>
      )}
    </section>
  );
}
