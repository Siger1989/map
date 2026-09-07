import { useEffect, useMemo, useRef, useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import { localPhotoInput, matchPhoto } from './matching';
import { readPhoto, type PhotoDraft } from './import';
import type { useTripPhotos } from './useTripPhotos';
import { PhotoPicker } from './PhotoPicker';
import { selectPhotoFiles } from './selection';
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
  photos,
  onOpen,
}: {
  tracks: ManualTrack[];
  preferred: string | null;
  photos: ReturnType<typeof useTripPhotos>;
  onOpen: (id: string) => void;
}) {
  const timed = tracks.filter(hasTrackTime);
  const [target, setTarget] = useState(preferred ?? timed[0]?.id ?? '');
  const [drafts, setDrafts] = useState<PhotoDraft[]>([]),
    [shift, setShift] = useState(0);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
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
      drafts.map((p) => ({
        draft: p,
        time: p.time === null ? null : p.time + shift * 60000,
        match: track
          ? matchPhoto(track, p.time === null ? null : p.time + shift * 60000)
          : null,
      })),
    [drafts, shift, track],
  );
  const count = matches.filter((p) => p.match).length;
  const loadFiles = async (selected: File[], folder: boolean) => {
    let files: File[];
    try {
      files = selectPhotoFiles(selected, folder);
    } catch (error) {
      setMessage((error as Error).message);
      return;
    }
    if (track) setTarget(track.id);
    setBusy(true);
    setDrafts([]);
    setShift(0);
    setMessage('正在读取拍摄时间和生成预览…');
    const next: PhotoDraft[] = [],
      failed: string[] = [];
    for (const file of files) {
      if (!active.current) return;
      try {
        next.push(await readPhoto(file));
      } catch (error) {
        failed.push(
          `${file.name}：${error instanceof Error ? error.message : '无法解码，请选择 JPEG 原片'}`,
        );
      }
    }
    if (!active.current) return;
    setDrafts(next);
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
        <PhotoPicker disabled={busy || !track} onFiles={loadFiles} />
      </div>
      {!timed.length && (
        <p className="route-note">
          先保存一次实走记录，或导入含时间的
          GPX。无时间的旧轨迹无法自动定位照片；若有原始 GPX
          可重新导入，普通手绘线不能补出真实拍摄时间轴。
        </p>
      )}
      {!!drafts.length && (
        <>
          <strong className="photo-target">
            {track?.name ?? '轨迹已不存在，请取消后重新选择'}
          </strong>
          <details>
            <summary>
              校正拍摄时间
              {shift ? `（${shift > 0 ? '+' : ''}${shift} 分钟）` : ''}
            </summary>
            <label>
              照片时间校正（分钟）
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
            <p className="route-note">
              正数把照片时间向后移。无拍摄时区时按本机时区解释；下列时间可逐张修正，不使用文件修改时间猜测。
            </p>
          </details>
          <strong role="status">
            可匹配 {count} / {drafts.length} 张
          </strong>
          <div className="photo-drafts">
            {matches.map(({ draft, match }, i) => (
              <article key={`${draft.hash}-${i}`}>
                <DraftImage blob={draft.preview} name={draft.name} />
                <div>
                  <span title={draft.name}>{draft.name}</span>
                  <small>
                    {match
                      ? match.kind === 'point'
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
                              }
                            : p,
                        ),
                      );
                    }}
                  />
                  <small>{draft.zone}</small>
                </div>
              </article>
            ))}
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
            <button disabled={busy} onClick={() => setDrafts([])}>
              取消本次
            </button>
          </div>
        </>
      )}
      <div className="outdoor-actions">
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
      <p className="route-note">
        原图保留不变，本机保存预览和最长边2560px的查看副本。每张 ≤20
        MB，本机最多200张 /
        200MB（预览≤40MB）。导入后按拍摄时间、位置向Open-Meteo查询天气，不上传图片。照片独立存储，暂不包含在普通
        JSON/GPX 备份中。
      </p>
      {(message || photos.error) && (
        <p className="route-note" role="status">
          {photos.error || message}
        </p>
      )}
    </div>
  );
}
