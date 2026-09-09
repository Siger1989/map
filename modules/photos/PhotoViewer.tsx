import { useEffect, useState } from 'react';
import type { VisiblePhoto } from './storage';
import type { ManualTrack } from '../tracks/drawing';
import type { PhotoDetails } from './details';
import { matchPhoto } from './matching';
import { PhotoLightbox } from './PhotoLightbox';
import { photoLocationLabel } from './association';
export function PhotoViewer({
  photo,
  group,
  onSelect,
  onClose,
  onRemove,
  onUpdate,
  track,
}: {
  photo: VisiblePhoto;
  group: VisiblePhoto[];
  onSelect: (id: string) => void;
  onClose: () => void;
  onRemove: (id: string) => Promise<void>;
  onUpdate: (id: string, patch: Omit<PhotoDetails, 'detail'>) => Promise<void>;
  track?: ManualTrack;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (photo.altitude || !track) return;
    const altitude = matchPhoto(track, photo.time)?.altitude;
    if (altitude)
      void onUpdate(photo.id, { altitude }).catch(() =>
        setError('海拔信息保存失败，请重试'),
      );
  }, [photo.id, photo.altitude, photo.time, track, onUpdate]);
  const index = group.findIndex((p) => p.id === photo.id);
  return (
    <section
      className="trip-photo-viewer glass"
      role="dialog"
      aria-label="行程照片预览"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (expanded) setExpanded(false);
          else onClose();
        }
      }}
    >
      <header>
        <strong>{photo.title || photo.name}</strong>
        <button aria-label="返回上一级" onClick={onClose}>
          ← 返回
        </button>
      </header>
      <button
        className="photo-expand"
        onClick={() => setExpanded(true)}
        aria-label="放大查看照片"
      >
        <img src={photo.url} alt={photo.title || photo.name} />
        <span>放大查看 · 编辑 / 标记 / 分享</span>
      </button>
      <p>
        {new Date(photo.time).toLocaleString('zh-CN')} ·{' '}
        {photoLocationLabel(photo)}{photo.timeSource === 'camera' && ' · 时间取自相机启动时刻'}
      </p>
      <p>
        {photo.trackName} · {photo.coordinates[1].toFixed(5)},{' '}
        {photo.coordinates[0].toFixed(5)}
      </p>
      <footer>
        {group.length > 1 && (
          <>
            <button
              disabled={index <= 0}
              onClick={() => onSelect(group[index - 1].id)}
            >
              上一张
            </button>
            <span>
              {index + 1}/{group.length}
            </span>
            <button
              disabled={index >= group.length - 1}
              onClick={() => onSelect(group[index + 1].id)}
            >
              下一张
            </button>
          </>
        )}
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onRemove(photo.id);
            } catch {
              setError('移除失败，请重试');
              setBusy(false);
            }
          }}
        >
          移除预览
        </button>
      </footer>
      {error && <p role="status">{error}</p>}
      {expanded && (
        <PhotoLightbox
          key={photo.id}
          photo={photo}
          onClose={() => setExpanded(false)}
          onUpdate={onUpdate}
        />
      )}
    </section>
  );
}
