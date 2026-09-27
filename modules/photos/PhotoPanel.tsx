import { useEffect, useMemo, useRef, useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import { localPhotoInput, matchPhoto, type PhotoMatch } from './matching';
import { cameraDraftTime, cameraLocationFallbackAllowed, reliableCaptureLocation } from './association';
import { readPhoto, type PhotoDraft } from './import';
import type { useTripPhotos } from './useTripPhotos';
import { PhotoPicker } from './PhotoPicker';
import { selectPhotoFiles } from './selection';
import type { PositionFix } from '../position/types';
import {
  hasTrackTime,
  photoTrackChoice,
  trackSourceLabel,
} from '../tracks/provenance';

function DraftImage({ blob, name }: { blob: Blob; name: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return <img src={url || undefined} alt={name} />;
}
export function PhotoPanel({
  tracks,
  preferred,
  folderReady,
  cameraPosition,
  liveTrackId,
  onRequestLocation,
  photos,
  onOpen,
}: {
  tracks: ManualTrack[];
  preferred: string | null;
  folderReady: boolean;
  cameraPosition: PositionFix | null;
  liveTrackId: string | null;
  onRequestLocation: () => void;
  photos: ReturnType<typeof useTripPhotos>;
  onOpen: (id: string) => void;
}) {
  const timed = tracks.filter(hasTrackTime);
  const [target, setTarget] = useState(preferred ?? timed[0]?.id ?? '');
  const [drafts, setDrafts] = useState<PhotoDraft[]>([]),
    [shift, setShift] = useState(0);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [draftPage, setDraftPage] = useState(0);
  const [savedPage, setSavedPage] = useState(0);
  const draftIndex = Math.min(draftPage, Math.max(0, drafts.length - 1));
  const savedPages = Math.ceil(photos.items.length / 4);
  const savedIndex = Math.min(savedPage, Math.max(0, savedPages - 1));
  const track = photoTrackChoice(
    tracks,
    target,
    preferred,
    drafts.length > 0 || busy,
  );
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const matches = useMemo(
    () =>
      drafts.map((p): { draft: PhotoDraft; time: number | null; match: (PhotoMatch & { locationSource?: 'track' | 'camera'; locationAccuracy?: number }) | null } => ({
        draft: p,
        time: p.time === null ? null : p.time + shift * 60000,
        match: track
          ? matchPhoto(track, p.time === null ? null : p.time + shift * 60000) ??
            (cameraLocationFallbackAllowed(p, shift, track.id)
              ? { coordinates: p.cameraCoordinates!, kind: 'point' as const, locationSource: 'camera' as const, locationAccuracy: p.cameraAccuracy }
              : null)
          : null,
      })),
    [drafts, shift, track],
  );
  const count = matches.filter((p) => p.match).length;
  const loadFiles = async (selected: File[], folder: boolean, capturedAt?: number, capturedTrackId?: string) => {
    let files: File[];
    try {
      files = selectPhotoFiles(selected, folder);
    } catch (error) {
      setMessage((error as Error).message);
      return;
    }
    if (capturedTrackId)
      setTarget(capturedTrackId);
    else if (track) setTarget(track.id);
    setBusy(true);
    setDrafts([]);
    setShift(0);
    setMessage('正在读取拍摄时间和生成预览…');
    const next: PhotoDraft[] = [],
      failed: string[] = [];
    for (const file of files) {
      if (!active.current) return;
      try {
        let draft = await readPhoto(file);
        // A camera result may use its capture-session time; imported files never do.
        draft = cameraDraftTime(draft, capturedAt);
        if (!folder && capturedTrackId) draft = { ...draft, cameraTrackId: capturedTrackId };
        const fix = reliableCaptureLocation(cameraPosition, draft.time);
        if (capturedTrackId && capturedTrackId === liveTrackId && fix) {
          draft = {
            ...draft,
            cameraCoordinates: fix.coordinates,
            cameraAccuracy: fix.accuracy,
            cameraTrackId: capturedTrackId,
            cameraLocationTimeSource: draft.timeSource === 'exif' ? 'capture' : 'return',
          };
        }
        next.push(draft);
      } catch (error) {
        failed.push(
          `${file.name}：${error instanceof Error ? error.message : '无法解码，请选择 JPEG 原片'}`,
        );
      }
    }
    if (!active.current) return;
    setDrafts(next);
    setDraftPage(0);
    setBusy(false);
    setMessage(
      failed.length
        ? failed.join('；')
        : `已读取 ${next.length} 张照片，请检查匹配结果`,
    );
  };
  return (
    <div className="photo-panel">
      <div className="photo-choose" hidden={drafts.length > 0}>
        <PhotoPicker disabled={busy} folderReady={folderReady} trackId={liveTrackId ?? track?.id ?? undefined} onFiles={loadFiles} />
        <label>
          匹配轨迹
          <select
            value={track?.id ?? ''}
            disabled={busy}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="照片匹配轨迹"
          >
            {!track && <option value="">请选择带时间的轨迹</option>}
            {tracks.map((t) => (
              <option key={t.id} value={t.id} disabled={!hasTrackTime(t)}>
                {t.name} · {trackSourceLabel(t)}
                {!hasTrackTime(t) ? '（无时间，不能匹配）' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!timed.length && !drafts.length && (
        <p className="route-note">
          自动定位需实走记录或含时间的 GPX，手绘线无法匹配。
        </p>
      )}
      {matches.some(({ draft, match }) => draft.cameraTrackId && !match) && (
        <p className="route-note" role="status">
          草稿已保留；补充拍摄时间，或定位后重新拍摄。
          <button type="button" onClick={onRequestLocation}>为后续拍摄获取当前位置</button>
        </p>
      )}
      {!!drafts.length && (
        <>
          {track && <strong className="photo-target">{track.name}</strong>}
          <label className="photo-time-shift" title="正数向后移；无时区按本机时区解释，不用文件修改时间猜测。">
              时间校正（分钟）
              <input
                type="number"
                min={-1440}
                max={1440}
                step={1}
                value={shift}
                disabled={busy}
                onChange={(e) =>
                  setShift(
                    Math.max(
                      -1440,
                      Math.min(1440, Number(e.target.value) || 0),
                    ),
                  )
                }
              />
          </label>
          <div className="photo-page-controls" aria-label="照片草稿切换">
            <button disabled={busy || draftIndex === 0} onClick={() => setDraftPage(draftIndex - 1)} aria-label="上一张照片">上一张</button>
            <span role="status">{draftIndex + 1}/{drafts.length} · 可匹配 {count} 张</span>
            <button disabled={busy || draftIndex >= drafts.length - 1} onClick={() => setDraftPage(draftIndex + 1)} aria-label="下一张照片">下一张</button>
          </div>
          <div className="photo-drafts">
            {matches.slice(draftIndex, draftIndex + 1).map(({ draft, match }, offset) => {
              const i = draftIndex + offset;
              return (
              <article key={`${draft.hash}-${i}`}>
                <DraftImage blob={draft.preview} name={draft.name} />
                <div>
                  <span title={draft.name}>{draft.name}</span>
                  <small>
                    {match
                      ? match.locationSource === 'camera'
                        ? `${draft.cameraLocationTimeSource === 'return' ? '返回时定位' : '拍摄时定位'} · ±${Math.round(match.locationAccuracy ?? 0)} 米`
                        : match.kind === 'point'
                        ? '匹配到记录点'
                        : '按前后记录点估算'
                      : '未匹配：补时间或检查轨迹断点'}
                  </small>
                  <input
                    aria-label={`拍摄时间 ${i + 1}`}
                    type="datetime-local"
                    step={1}
                    value={localPhotoInput(draft.time)}
                    disabled={busy}
                    onChange={(e) => {
                      const value = e.target.value
                        ? new Date(e.target.value).getTime()
                        : null;
                      setDrafts((list) =>
                        list.map((p, n) =>
                          n === i
                            ? {
                                ...p,
                                time:
                                  value !== null && Number.isFinite(value)
                                    ? value
                                    : null,
                                timeSource: undefined,
                                timeSourceDetail: value !== null && Number.isFinite(value) ? 'manual' : undefined,
                              }
                            : p,
                        ),
                      );
                    }}
                  />
                  <small title={draft.zone}>时间来源：{draft.timeSourceDetail === 'manual' ? '手动补充' : draft.timeSourceDetail === 'return-estimate' ? '相机返回时间（估计）' : draft.timeSource === 'exif' ? '照片 EXIF' : '未知'} · {draft.zone}</small>
                </div>
              </article>
              );
            })}
          </div>
          <div className="outdoor-actions photo-confirm">
            <button
              disabled={busy || !count || !track}
              onClick={async () => {
                if (!track) return;
                setBusy(true);
                try {
                  await photos.save(
                    matches.flatMap(({ draft, time, match }) =>
                      match && time !== null
                        ? [
                            {
                              id: `${draft.hash}:${track.id}`,
                              name: draft.name,
                              preview: draft.preview,
                              detail: draft.detail,
                              altitude: draft.altitude ?? match.altitude,
                              time,
                              coordinates: match.coordinates,
                              kind: match.kind,
                              ...(draft.timeSource ? { timeSource: draft.timeSource } : {}),
                              ...(draft.timeSourceDetail ? { timeSourceDetail: draft.timeSourceDetail } : {}),
                              locationSource: match.locationSource ?? 'track',
                              ...(match.locationAccuracy !== undefined ? { locationAccuracy: match.locationAccuracy } : {}),
                              ...(draft.cameraLocationTimeSource ? { locationTimeSource: draft.cameraLocationTimeSource } : {}),
                              trackId: track.id,
                              trackName: track.name,
                            },
                          ]
                        : [],
                    ),
                  );
                  if (active.current) {
                    setMessage(
                      `已加入 ${count} 张照片预览；同轨迹重复照片自动更新`,
                    );
                    setDrafts((list) =>
                      list.filter((_, i) => !matches[i].match),
                    );
                  }
                } catch (error) {
                  if (active.current) setMessage((error as Error).message);
                } finally {
                  if (active.current) setBusy(false);
                }
              }}
            >
              加入地图（{count}）
            </button>
            <button disabled={busy} onClick={() => { setDrafts([]); setMessage(''); }}>
              取消本次
            </button>
          </div>
          <small className="route-note">草稿尚未保存，离开前请先加入地图。</small>
        </>
      )}
      {!drafts.length && <>
      <div className="outdoor-actions photo-library-heading">
        <button
          aria-pressed={photos.visible}
          onClick={() => photos.setVisible(!photos.visible)}
        >
          {photos.visible ? '隐藏地图照片' : '显示地图照片'}
        </button>
        <span>已存 {photos.items.length} 张</span>
      </div>
      <div className="photo-saved">
        {photos.items
          .slice()
          .sort((a, b) => a.time - b.time)
          .slice(savedIndex * 4, savedIndex * 4 + 4)
          .map((p) => (
            <button key={p.id} onClick={() => onOpen(p.id)} title={p.name}>
              <img src={p.url} alt={p.name} />
              <small>
                {new Date(p.time).toLocaleTimeString('zh-CN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            </button>
          ))}
      </div>
      {savedPages > 1 && <div className="photo-page-controls" aria-label="已存照片翻页">
        <button disabled={savedIndex === 0} onClick={() => setSavedPage(savedIndex - 1)}>上一页</button>
        <span>{savedIndex + 1}/{savedPages}</span>
        <button disabled={savedIndex >= savedPages - 1} onClick={() => setSavedPage(savedIndex + 1)}>下一页</button>
      </div>}
      <p className="route-note">
        原图不变，照片单独存储，不含在GPX/JSON备份中。按时间、位置查询天气，不上传图片。
      </p>
      </>}
      {(message || photos.error) && (
        <p className="route-note" role="status">
          {photos.error || message}
        </p>
      )}
    </div>
  );
}
