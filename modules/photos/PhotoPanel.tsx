import type { usePhotoImportSession } from './usePhotoImportSession';
import { readPhotoIndex } from './storage';
import { PhotoThumbnail } from './PhotoThumbnail';
import { useEffect, useRef, useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import { hasTrackTime, photoTrackChoice } from '../tracks/provenance';
import type { useTripPhotos } from './useTripPhotos';
import { PhotoPicker } from './PhotoPicker';
import { selectPhotoFiles } from './selection';
import {
  classifyPhoto,
  photoHash,
  photoTimeRange,
  readPhotoMetadata,
  type PhotoMetadata,
} from './metadata';
import { readPhoto } from './import';
import { matchPhoto, localPhotoInput } from './matching';
import { PhotoPending } from './PhotoPending';
type Pending = { file: File; meta: PhotoMetadata; reason: string };
export function PhotoPanel({
  tracks,
  preferred,
  photos,
  onOpen,
  onPlace,
  session,
}: {
  tracks: ManualTrack[];
  preferred: string | null;
  session: ReturnType<typeof usePhotoImportSession>;
  photos: ReturnType<typeof useTripPhotos>;
  onOpen: (id: string) => void;
  onPlace?: (file: File, trackId: string, time: number | null) => void;
}) {
  const {
    target,
    setTarget,
    pending,
    setPending,
    tolerance,
    setTolerance,
    shift,
    setShift,
    message,
    setMessage,
    files: filesRef,
  } = session;
  const [busy, setBusy] = useState(false),
    [showPending, setShowPending] = useState(false);
  const stop = useRef(false),
    alive = useRef(true);
  const track = photoTrackChoice(
    tracks,
    target,
    preferred,
    busy || pending.length > 0,
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);
  const saved = photos.items.filter((p) => p.trackId === track?.id);
  const add = async (
    file: File,
    meta: PhotoMetadata,
    allowEstimate = false,
  ) => {
    if (!track) throw new Error('行程已不存在');
    const result = classifyPhoto(track, meta, tolerance),
      match = allowEstimate
        ? matchPhoto(track, meta.time)
        : result.status === 'matched'
          ? result.match
          : null;
    if (!match || meta.time === null) throw new Error(result.reason);
    const hash = await photoHash(file),
      id = `${hash}:${track.id}`;
    if ((await readPhotoIndex(track.id)).some((p) => p.id === id)) return false;
    if (stop.current) throw new Error('已停止');
    const draft = await readPhoto(file, () => {}, meta, hash);
    if (stop.current) throw new Error('已停止');
    await photos.save([
      {
        id,
        name: draft.name,
        trackId: track.id,
        trackName: track.name,
        time: meta.time,
        coordinates: match.coordinates,
        kind: match.kind,
        positionSource: allowEstimate ? 'time' : 'gps',
        ...(meta.gps && { photoCoordinates: meta.gps }),
        preview: draft.preview,
        detail: draft.detail,
        altitude: meta.altitude ?? match.altitude,
      },
    ]);
    return true;
  };
  const loadFiles = async (selected: File[], folder: boolean) => {
    if (!track || busy) return;
    let files: File[];
    try {
      files = selectPhotoFiles(selected, folder);
    } catch (e) {
      setMessage((e as Error).message);
      return;
    }
    setTarget(track.id);
    filesRef.current = files;
    stop.current = false;
    setBusy(true);
    setPending([]);
    let added = 0,
      skipped = 0,
      duplicates = 0,
      failed = 0;
    const waiting: Pending[] = [];
    for (let i = 0; i < files.length; i++) {
      if (stop.current || !alive.current) break;
      setMessage(`检查元数据 ${i + 1}/${files.length} · 已关联 ${added}`);
      try {
        const raw = await readPhotoMetadata(files[i]),
          meta = {
            ...raw,
            time: raw.time === null ? null : raw.time + shift * 60000,
          };
        const result = classifyPhoto(track, meta, tolerance);
        if (result.status === 'skip') skipped++;
        else if (result.status === 'pending')
          waiting.push({ file: files[i], meta, reason: result.reason });
        else if (await add(files[i], meta)) added++;
        else duplicates++;
      } catch (e) {
        if (!stop.current) {
          failed++;
          waiting.push({
            file: files[i],
            meta: { time: null, zone: '' },
            reason: e instanceof Error ? e.message : '读取失败',
          });
        }
      }
    }
    if (alive.current) {
      setPending(waiting);
      setBusy(false);
      setMessage(
        `${stop.current ? '已停止；' : '完成；'}新增 ${added} · 已关联跳过 ${duplicates} · 时间外 ${skipped} · 待确认 ${waiting.length}${failed ? `（含失败 ${failed}）` : ''}`,
      );
    }
  };
  const confirm = async (index: number, time: number | null) => {
    const item = pending[index];
    if (!item) return;
    stop.current = false;
    setBusy(true);
    try {
      await add(item.file, { ...item.meta, time }, true);
      setPending((list) => list.filter((_, i) => i !== index));
      setMessage('已确认并关联；位置取自行程时间估算。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '保存失败');
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const range = track ? photoTimeRange(track) : null;
  return (
    <div className="photo-panel">
      <label>
        当前行程
        <select
          aria-label="照片匹配行程"
          value={track?.id ?? ''}
          disabled={busy}
          onChange={(e) => {
            setTarget(e.target.value);
            setPending([]);
          }}
        >
          <option value="">请选择行程</option>
          {tracks.filter(hasTrackTime).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {range && (
        <small>
          {new Date(range.start).toLocaleString()} —{' '}
          {new Date(range.end).toLocaleString()}
        </small>
      )}
      <PhotoPicker
        disabled={busy || !track}
        range={
          range
            ? {
                start: range.start - shift * 60000,
                end: range.end - shift * 60000,
              }
            : null
        }
        onFiles={loadFiles}
      />
      <details>
        <summary>筛选设置与来源</summary>
        <label>
          坐标允许偏差（米）
          <input
            type="number"
            min={10}
            max={1000}
            step={10}
            value={tolerance}
            disabled={busy}
            onChange={(e) =>
              setTolerance(
                Math.max(10, Math.min(1000, Number(e.target.value) || 100)),
              )
            }
          />
        </label>
        <label>
          相机时间校正（分钟）
          <input
            type="number"
            min={-1440}
            max={1440}
            value={shift}
            disabled={busy}
            onChange={(e) =>
              setShift(
                Math.max(-1440, Math.min(1440, Number(e.target.value) || 0)),
              )
            }
          />
        </label>
        <small>
          先筛行程时间，再核对照片坐标。无坐标、缺时间或冲突进入待确认。文件夹需逐项读元数据；匹配后才生成副本。
        </small>
        <button
          disabled={busy || !filesRef.current.length}
          onClick={() => void loadFiles(filesRef.current, true)}
        >
          重新匹配已选来源
        </button>
      </details>
      {busy && (
        <button
          onClick={() => {
            stop.current = true;
          }}
        >
          停止扫描
        </button>
      )}
      <p role="status">{message || photos.error}</p>
      {!!pending.length && (
        <>
          <button onClick={() => setShowPending(!showPending)}>
            待确认 {pending.length} 张 {showPending ? '收起' : '展开'}
          </button>
          {showPending &&
            pending.map((p, i) => (
              <PhotoPending
                key={`${p.file.name}-${i}`}
                file={p.file}
                meta={p.meta}
                reason={p.reason}
                disabled={busy}
                onConfirm={(time) => void confirm(i, time)}
                onPlace={
                  onPlace && track
                    ? (time) => onPlace(p.file, track.id, time)
                    : undefined
                }
              />
            ))}
        </>
      )}
      <strong>此行程照片 · {saved.length} 张</strong>
      <div className="photo-saved">
        {saved
          .slice()
          .sort((a, b) => a.time - b.time)
          .map((p) => (
            <button key={p.id} onClick={() => onOpen(p.id)}>
              <PhotoThumbnail
                id={p.id}
                src={p.url || undefined}
                alt={p.title || p.name}
              />
              <small>
                {new Date(p.time).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            </button>
          ))}
      </div>
      <button
        aria-pressed={photos.visible}
        onClick={() => photos.setVisible(!photos.visible)}
      >
        {photos.visible ? '隐藏地图照片' : '显示地图照片'}
      </button>
      <details>
        <summary>照片存储与天气</summary>
        <small>
          原图保留。本机最多200张，预览40MB /
          含清晰副本200MB。仅按需生成最长边2560px副本。天气按拍摄时间和坐标查询，不上传图片；照片不包含在普通GPX/JSON中。
        </small>
      </details>
    </div>
  );
}
