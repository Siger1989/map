import { useEffect, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import type { ManualTrack } from '../tracks/drawing';
import type { useTripPhotos } from './useTripPhotos';
import { readPhotoMetadata } from './metadata';
import { readPhoto } from './import';
import { localPhotoInput } from './matching';
import { PHOTO_ACCEPT } from './selection';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
export type PhotoPlacementJob = {
  file?: File;
  trackId?: string;
  time?: number | null;
  coordinate: Coordinate | null;
  returnPhotos?: boolean;
};
export function PhotoPlacement({
  job,
  track,
  photos,
  onPick,
  onClose,
  onSaved,
}: {
  job: PhotoPlacementJob;
  track?: ManualTrack;
  photos: ReturnType<typeof useTripPhotos>;
  onPick: () => void;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [file, setFile] = useState(job.file),
    [time, setTime] = useState(job.time ?? null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const root = useRouteDialogFocus(() => {
    if (!busy) onClose();
  });
  useEffect(() => {
    if (!file) return;
    let active = true;
    void readPhotoMetadata(file)
      .then((meta) => {
        if (active && meta.time !== null) setTime(meta.time);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [file]);
  const save = async () => {
    if (!file || !job.coordinate || time === null) return;
    setBusy(true);
    setError('');
    try {
      if (job.trackId && !track)
        throw new Error('原行程已不存在，请取消后重新选择');
      const draft = await readPhoto(file),
        id = `${draft.hash}:${track?.id ?? 'manual-map'}`;
      await photos.save([
        {
          id,
          name: draft.name,
          time,
          trackId: track?.id ?? '',
          trackName: track?.name ?? '地图选点',
          coordinates: job.coordinate,
          kind: 'point',
          positionSource: 'manual',
          ...(draft.gps && { photoCoordinates: draft.gps }),
          preview: draft.preview,
          detail: draft.detail,
          altitude: draft.altitude,
        },
      ]);
      onSaved(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，所选照片保留');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      ref={root}
      className="trip-details route-surface"
      role="dialog"
      aria-modal="false"
      aria-label="在选定位置添加照片"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header>
        <strong>选点添加照片</strong>
        <button disabled={busy} onClick={onClose}>
          返回
        </button>
      </header>
      <div className="trip-detail-scroll">
        <small>
          {job.coordinate
            ? `${job.coordinate[1].toFixed(5)}，${job.coordinate[0].toFixed(5)}`
            : '点击地图或轨迹选择位置'}
        </small>
        {job.coordinate && (
          <button disabled={busy} onClick={onPick}>
            重新选点
          </button>
        )}
        <div className="trip-more">
          <label className="import-file">
            选择照片
            <input
              type="file"
              accept={PHOTO_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.[0]) setFile(e.target.files[0]);
                e.target.value = '';
              }}
            />
          </label>
          <label className="import-file">
            拍照
            <input
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  setFile(e.target.files[0]);
                  setTime(Date.now());
                }
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {file && <small>{file.name}</small>}
        <label>
          拍摄时间
          <input
            type="datetime-local"
            step={1}
            value={localPhotoInput(time)}
            disabled={busy}
            onChange={(e) =>
              setTime(
                e.target.value ? new Date(e.target.value).getTime() : null,
              )
            }
          />
        </label>
        <button
          disabled={busy || !file || !job.coordinate || time === null}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '添加到此位置'}
        </button>
        <small>手动位置保留，重新自动匹配不会覆盖。</small>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
