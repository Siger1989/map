import { useState } from 'react';
import type { VisiblePhoto } from './storage';
export function PhotoViewer({
  photo,
  group,
  onSelect,
  onClose,
  onRemove,
}: {
  photo: VisiblePhoto;
  group: VisiblePhoto[];
  onSelect: (id: string) => void;
  onClose: () => void;
  onRemove: (id: string) => Promise<void>;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const index = group.findIndex((p) => p.id === photo.id);
  return (
    <section
      className="trip-photo-viewer glass"
      role="dialog"
      aria-label="行程照片预览"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <strong>{photo.name}</strong>
        <button aria-label="关闭照片预览" onClick={onClose}>
          ×
        </button>
      </header>
      <img src={photo.url} alt={photo.name} />
      <p>
        {new Date(photo.time).toLocaleString('zh-CN')} ·{' '}
        {photo.kind === 'point' ? '对应轨迹点' : '轨迹时间估算位置'}
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
    </section>
  );
}
