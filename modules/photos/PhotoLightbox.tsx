import { useEffect, useRef, useState } from 'react';
import type { VisiblePhoto } from './storage';
import {
  altitudeLabel,
  weatherSource,
  type PhotoDetails,
  type PhotoEdits,
  type PhotoStroke,
} from './details';
import { PhotoStage } from './PhotoStage';
import { deliverPhoto, renderPhotoExport, weatherLabel } from './export';
export function PhotoLightbox({
  photo,
  onClose,
  onUpdate,
}: {
  photo: VisiblePhoto;
  onClose: () => void;
  onUpdate: (id: string, patch: Omit<PhotoDetails, 'detail'>) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState(''),
    [mode, setMode] = useState<'view' | 'edit' | 'ink' | 'share' | 'info'>(
      'view',
    );
  const [draft, setDraft] = useState<PhotoEdits>({}),
    [color, setColor] = useState<PhotoStroke['color']>('#ff625c');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const [includeInfo, setIncludeInfo] = useState(true),
    [file, setFile] = useState<File | null>(null),
    [exportUrl, setExportUrl] = useState('');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    const next = URL.createObjectURL(photo.detail ?? photo.preview);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [photo.detail, photo.preview]);
  useEffect(() => {
    if (!file) {
      setExportUrl('');
      return;
    }
    const next = URL.createObjectURL(file);
    setExportUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  const editing = mode === 'edit' || mode === 'ink';
  const current = editing ? { ...photo, ...draft } : photo;
  const back = () => {
    if (busy) return;
    if (mode === 'view') onClose();
    else {
      setMode('view');
      setMessage('');
      setFile(null);
    }
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError'))
        setMessage(e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const edit = (next: 'edit' | 'ink') => {
    setDraft({
      title: photo.title ?? '',
      note: photo.note ?? '',
      rotation: photo.rotation ?? 0,
      strokes: photo.strokes ?? [],
    });
    setMode(next);
    setMessage('');
  };
  return (
    <dialog
      ref={dialog}
      className="photo-lightbox"
      aria-label="全屏照片"
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        back();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          back();
        }
      }}
    >
      <header>
        <button
          disabled={busy}
          onClick={back}
          aria-label={mode === 'view' ? '退出照片全屏' : '返回照片查看'}
        >
          ‹ {editing ? '取消' : '返回'}
        </button>
        <strong>
          {mode === 'ink'
            ? '照片画线标记'
            : mode === 'edit'
              ? '编辑照片信息'
              : mode === 'share'
                ? '分享照片副本'
                : photo.title || photo.name}
        </strong>
        {editing && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onUpdate(photo.id, draft);
                setMode('view');
                setMessage('修改已保存');
              })
            }
          >
            保存修改
          </button>
        )}
      </header>
      {mode !== 'share' && (
        <PhotoStage
          url={url}
          name={photo.title || photo.name}
          rotation={current.rotation ?? 0}
          strokes={current.strokes ?? []}
          drawing={mode === 'ink'}
          color={color}
          onStrokes={(strokes) => setDraft((d) => ({ ...d, strokes }))}
        />
      )}
      {mode === 'view' && (
        <>
          <div className="photo-summary">
            <p>
              {new Date(photo.time).toLocaleString('zh-CN')} ·{' '}
              {altitudeLabel(photo.altitude)}
            </p>
            <p>{weatherLabel(photo)}</p>
          </div>
          <nav className="photo-action-bar" aria-label="照片操作">
            <button onClick={() => edit('edit')}>编辑</button>
            <button onClick={() => edit('ink')}>标记</button>
            <button
              onClick={() => {
                setMode('share');
                setFile(null);
                setMessage('');
              }}
            >
              分享
            </button>
            <button onClick={() => setMode('info')}>详细信息</button>
          </nav>
        </>
      )}
      {mode === 'edit' && (
        <form className="photo-editor" onSubmit={(e) => e.preventDefault()}>
          <label>
            照片标题
            <input
              maxLength={100}
              value={draft.title}
              disabled={busy}
              onChange={(e) =>
                setDraft((d) => ({ ...d, title: e.target.value }))
              }
            />
          </label>
          <label>
            照片备注
            <textarea
              maxLength={1000}
              rows={2}
              value={draft.note}
              disabled={busy}
              onChange={(e) =>
                setDraft((d) => ({ ...d, note: e.target.value }))
              }
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setDraft((d) => ({
                ...d,
                rotation: ((d.rotation ?? 0) + 90) % 360,
              }))
            }
          >
            旋转90°
          </button>
          <small>修改保存在本机，原图文件保持不变</small>
        </form>
      )}
      {mode === 'ink' && (
        <div className="photo-ink-tools">
          {(['#ff625c', '#ffda63', '#ffffff'] as const).map((c, i) => (
            <button
              key={c}
              disabled={busy}
              aria-label={['红色画笔', '黄色画笔', '白色画笔'][i]}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              style={{ color: c }}
            >
              ●
            </button>
          ))}
          <button
            disabled={busy || !draft.strokes?.length}
            onClick={() =>
              setDraft((d) => ({ ...d, strokes: d.strokes?.slice(0, -1) }))
            }
          >
            撤销
          </button>
          <button
            disabled={busy || !draft.strokes?.length}
            onClick={() => setDraft((d) => ({ ...d, strokes: [] }))}
          >
            清空标记
          </button>
          <small>{draft.strokes?.length ?? 0}/80 笔</small>
        </div>
      )}
      {mode === 'info' && (
        <div className="photo-information">
          <p>{photo.note || '暂无备注，可在“编辑”中填写。'}</p>
          <p>
            {photo.trackName} · {photo.coordinates[1].toFixed(5)},{' '}
            {photo.coordinates[0].toFixed(5)} ·{' '}
            {photo.kind === 'interpolated' ? '轨迹时间估算位置' : '对应轨迹点'}
          </p>
          <p>{altitudeLabel(photo.altitude)}</p>
          <p>{weatherLabel(photo)}</p>
          {photo.weather && (
            <>
              <p>{weatherSource(photo.weather)} · 非现场实测</p>
              <p>
                天气时次 {new Date(photo.weather.time).toLocaleString('zh-CN')}
                <br />
                获取于{' '}
                {new Date(photo.weather.fetchedAt).toLocaleString('zh-CN')}
              </p>
              <p>
                最近整点天气；降水为该时次前1小时累计。数据：Open-Meteo，CC BY
                4.0。
              </p>
            </>
          )}
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onUpdate(photo.id, {
                  weather: undefined,
                  weatherError: undefined,
                });
                setMessage('已重新排队查询拍摄天气');
              })
            }
          >
            重新查询拍摄天气
          </button>
          <p>
            {photo.detail
              ? '查看副本最长边2560px，原图文件未改动。'
              : '旧照片只有960px预览，重新导入同一原图可补充更清晰的副本并保留标记。'}
          </p>
          <p>缩放不会增加原图细节。缺少海拔时需有EXIF海拔或对应轨迹海拔。</p>
        </div>
      )}
      {mode === 'share' && (
        <div className="photo-share-panel">
          <label>
            <input
              type="checkbox"
              checked={includeInfo}
              disabled={busy}
              onChange={(e) => {
                setIncludeInfo(e.target.checked);
                setFile(null);
              }}
            />
            附上拍摄时间、位置、海拔、天气和备注
          </label>
          <p>生成带标记的图片副本，预览后自行选择分享对象。</p>
          {exportUrl ? (
            <img
              className="photo-export-preview"
              src={exportUrl}
              alt="待分享图片预览"
            />
          ) : (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  setFile(await renderPhotoExport(photo, includeInfo)),
                )
              }
            >
              {busy ? '正在生成…' : '生成分享图片'}
            </button>
          )}
          {file && (
            <div className="photo-action-bar">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setMessage(await deliverPhoto(file, true)),
                  )
                }
              >
                分享图片
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    setMessage(await deliverPhoto(file, false)),
                  )
                }
              >
                保存图片
              </button>
            </div>
          )}
        </div>
      )}
      {message && (
        <p className="photo-operation-status" role="status">
          {message}
        </p>
      )}
    </dialog>
  );
}
