import type { ManualTrack } from '../tracks/drawing';
import type { VisiblePhoto } from './storage';
import { photosForTrack } from './trackPhotos';

export function TrackPhotoGallery({
  track,
  photos,
  onOpen,
  onAdd,
}: {
  track: ManualTrack;
  photos: VisiblePhoto[];
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const items = photosForTrack(track, photos);
  return (
    <section className="track-photos" aria-label="此轨迹照片">
      <div className="track-photo-heading">
        <strong>行程照片 · {items.length} 张</strong>
        <button onClick={onAdd}>添加照片</button>
      </div>
      {items.length ? (
        <div className="track-photo-strip">
          {items.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpen(p.id)}
              title={p.title || p.name}
            >
              <img src={p.url} alt={p.title || p.name} loading="lazy" />
              <small>
                {new Date(p.time).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <small>此轨迹尚未关联照片，可在这里继续添加。</small>
      )}
    </section>
  );
}
