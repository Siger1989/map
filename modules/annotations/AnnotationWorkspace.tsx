import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  Clipboard,
  FileText,
  Navigation,
  Pencil,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import type { VisiblePhoto } from '../photos/storage';
import { MarkerPhotos } from './MarkerPhotos';
import type { Annotation } from './data';
import { dimensionLabel, volume } from './data';
import type { AnnotationsState } from './useAnnotations';
import { AnnotationLocation } from './AnnotationLocation';
import {
  readRegions,
  REGION_STORAGE,
  coordinateKey,
} from '../collections/regions';
import {
  AnnotationIcon,
  MarkerBasic,
  MarkerCoordinates,
  MarkerData,
} from './AnnotationFields';
import './markerWorkspace.css';

export type MarkerTab = 'basic' | 'position' | 'data';
export function AnnotationWorkspace({
  state,
  shownItem,
  tab,
  onTab,
  onClose,
  onNavigate,
  onShare,
  dragging,
  terrainStatus,
  photos = [],
  onCapture,
  onPhoto,
  cameraStatus,
  cameraBusy,
  cameraRetry,
  onCameraRetry,
}: {
  state: AnnotationsState;
  shownItem: Annotation;
  tab: MarkerTab;
  onTab: (tab: MarkerTab) => void;
  onClose: () => void;
  onNavigate: (item: Annotation) => void;
  onShare: (id: string) => void;
  dragging: boolean;
  terrainStatus?: string;
  photos?: VisiblePhoto[];
  onCapture: (item: Annotation) => void;
  onPhoto: (id: string) => void;
  cameraStatus?: string;
  cameraBusy?: boolean;
  cameraRetry?: boolean;
  onCameraRetry?: () => void;
}) {
  const [view, setView] = useState<'summary' | 'details'>('summary');
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);
  const root = useRef<HTMLElement>(null);
  const editing = !!state.edit;
  const item = shownItem;
  const base = state.edit?.base ?? item;
  const askLeave = confirm === 'leave' || !!state.selectionRequest;
  const finishLeave = (save: boolean) => {
    if (save && !state.saveEdit()) return;
    if (!save) state.cancelEdit();
    if (save) state.rememberAttributes(item.id);
    setConfirm(null);
    setView('summary');
    if (state.selectionRequest) state.resolveSelection(true);
  };
  const back = () => {
    if (confirm || state.selectionRequest) {
      setConfirm(null);
      state.resolveSelection(false);
      return;
    }
    if (editing) {
      if (state.dirty) setConfirm('leave');
      else {
        state.cancelEdit();
        setView('summary');
      }
    } else if (view === 'details') setView('summary');
    else onClose();
  };
  const latestBack = useRef(back);
  latestBack.current = back;
  useEffect(() => {
    const dialog = root.current?.querySelector<HTMLElement>('.marker-confirm');
    if (dialog) dialog.querySelector<HTMLButtonElement>('button')?.focus();
  }, [confirm, state.selectionRequest]);
  useEffect(() => {
    let frame = 0;
    const keepInputVisible = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const input = document.activeElement;
        if (
          input instanceof HTMLElement &&
          root.current?.contains(input) &&
          input.matches('input, textarea, select')
        )
          input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    };
    window.addEventListener('resize', keepInputVisible);
    window.visualViewport?.addEventListener('resize', keepInputVisible);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', keepInputVisible);
      window.visualViewport?.removeEventListener('resize', keepInputVisible);
    };
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || dragging) return;
      event.preventDefault();
      event.stopPropagation();
      latestBack.current();
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [dragging]);
  useEffect(() => {
    if (!state.dirty) return;
    const leave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [state.dirty]);
  const startEdit = (precise = false) => {
    state.beginEdit(item.id);
    onTab(precise ? 'position' : 'basic');
  };
  const change = (patch: Partial<Annotation>) => {
    const ok = state.update(item.id, patch);
    if (ok && patch.coordinates)
      void state.refreshElevation(item.id, patch.coordinates);
    return ok;
  };
  let place = '地点标记';
  try {
    const region = readRegions(localStorage.getItem(REGION_STORAGE))[
      `annotation:${item.id}`
    ];
    if (region?.coordinateKey === coordinateKey(item.coordinates))
      place =
        [region.city, region.township || region.district]
          .filter(Boolean)
          .join(' · ') ||
        region.province ||
        place;
    else
      place = `${item.coordinates[1].toFixed(4)}°, ${item.coordinates[0].toFixed(4)}°`;
  } catch {
    /* Exact coordinates remain in details if region cache is unavailable. */
  }
  return (
    <section
      ref={root}
      className="marker-workspace"
      aria-label={
        editing ? '编辑标记' : view === 'details' ? '标记详情' : '标记摘要'
      }
      data-view={editing ? tab : view}
      data-dragging={dragging}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          back();
        }
        if (e.key === 'Tab' && (confirm || state.selectionRequest)) {
          const buttons = root.current?.querySelectorAll<HTMLButtonElement>(
            '.marker-confirm button',
          );
          if (!buttons?.length) return;
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }}
    >
      {editing ? (
        <header className="marker-editor-bar">
          <button aria-label="返回标记摘要" onClick={back}>
            <ChevronLeft size={20} />
          </button>
          <nav aria-label="标记编辑分组">
            {(
              [
                ['basic', '基本'],
                ['position', '位置'],
                ['data', '资料'],
              ] as const
            ).map(([id, name]) => (
              <button
                key={id}
                aria-pressed={tab === id}
                onClick={() => onTab(id)}
              >
                {name}
              </button>
            ))}
          </nav>
          <button
            className="marker-save"
            onClick={() => {
              if (state.saveEdit()) {
                state.rememberAttributes(item.id);
                setView('summary');
              }
            }}
          >
            保存
          </button>
        </header>
      ) : view === 'summary' ? (
        <>
          <header className="marker-summary-title">
            <AnnotationIcon item={item} />
            <strong title={item.name}>{item.name || '未命名'}</strong>
            <button
              className="marker-delete"
              aria-label="删除标记"
              onClick={() => setConfirm('delete')}
            >
              <Trash2 size={16} />
            </button>
            <button aria-label="关闭标记" onClick={onClose}>
              <X size={20} />
            </button>
          </header>
          <div className="marker-summary-place">
            <span title={place}>{place}</span>
            <span>
              {item.groundElevation === null
                ? '海拔 —'
                : `海拔 ${Number(item.groundElevation.toFixed(1))} m`}
            </span>
          </div>
          <div className="marker-summary-actions">
            <button className="marker-primary" onClick={() => onNavigate(item)}>
              <Navigation size={17} />
              导航
            </button>
            <button onClick={() => startEdit()}>
              <Pencil size={17} />
              编辑
            </button>
            <button disabled={cameraBusy} onClick={() => onCapture(item)}>
              <Camera size={17} />
              拍照
            </button>
            <button onClick={() => setView('details')}>
              <FileText size={17} />
              详情
            </button>
          </div>
        </>
      ) : (
        <header className="marker-details-bar">
          <button aria-label="返回标记摘要" onClick={back}>
            <ChevronLeft size={20} />
          </button>
          <strong>标记详情</strong>
          <button aria-label="分享标记" onClick={() => onShare(item.id)}>
            <Share2 size={18} />
          </button>
        </header>
      )}
      {state.error && (
        <p className="marker-error" role="status">
          {state.error}
        </p>
      )}
      {cameraStatus && (
        <p className="marker-camera-status" role="status">
          {cameraStatus}
          {cameraRetry && <button onClick={onCameraRetry}>重试保存</button>}
        </p>
      )}
      {!editing && view === 'summary' && photos.length > 0 && (
        <div className="marker-summary-photos">
          <MarkerPhotos photos={photos} onOpen={onPhoto} />
        </div>
      )}
      {editing && (
        <div className="marker-scroll" key={tab}>
          {tab === 'basic' && (
            <MarkerBasic
              item={item}
              base={base}
              change={change}
              terrainStatus={terrainStatus}
            />
          )}
          {tab === 'position' &&
            (item.trackAnchor ? (
              <p>
                已绑定行程，不能单独移动。
                <br />
                经度 {item.coordinates[0].toFixed(6)} · 纬度{' '}
                {item.coordinates[1].toFixed(6)}
              </p>
            ) : (
              <MarkerCoordinates
                item={item}
                base={base}
                change={change}
                reading={state.reading}
                refresh={() =>
                  void state.refreshElevation(item.id, item.coordinates)
                }
              />
            ))}
          {tab === 'data' && <MarkerData item={item} change={change} />}
        </div>
      )}
      {!editing && view === 'details' && (
        <div className="marker-scroll marker-details">
          <h3>{item.name || '未命名'}</h3>
          <AnnotationLocation item={item} onEdit={() => startEdit(true)} />
          {item.kind !== 'pin' && (
            <p>
              {dimensionLabel(item)} · 体积约 {volume(item)?.toFixed(2)} m³
            </p>
          )}
          {(item.attributes ?? []).length > 0 && (
            <dl>
              {item.attributes!.map((f, i) => (
                <div key={i}>
                  <dt>{f.name || '未命名属性'}</dt>
                  <dd>{f.value || '—'}</dd>
                </div>
              ))}
            </dl>
          )}
          {item.note && <p className="marker-detail-note">{item.note}</p>}
          <MarkerPhotos photos={photos} onOpen={onPhoto} />
          {item.trackAnchor && (
            <small>
              已关联行程 · 距起点{' '}
              {(item.trackAnchor.distance / 1000).toFixed(2)} 公里
            </small>
          )}
          <button
            onClick={() => {
              state.duplicate(item.id);
            }}
          >
            <Clipboard size={16} />
            复制为新标记
          </button>
        </div>
      )}
      {(confirm === 'delete' || askLeave) && (
        <div
          className="marker-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label={askLeave ? '保存标记修改' : '确认删除标记'}
        >
          <strong>
            {askLeave ? '保存这次修改？' : `删除“${item.name || '未命名'}”？`}
          </strong>
          <p>
            {askLeave
              ? '保存后生效，放弃将恢复编辑前的内容。'
              : '删除此标记及地图上的照片展示；关联路线与照片原文件保留。'}
          </p>
          {state.error && (
            <p className="marker-error" role="alert">
              {state.error}
            </p>
          )}
          <div>
            {askLeave ? (
              <>
                <button
                  className="marker-primary"
                  onClick={() => finishLeave(true)}
                >
                  保存
                </button>
                <button onClick={() => finishLeave(false)}>放弃</button>
                <button
                  onClick={() => {
                    setConfirm(null);
                    state.resolveSelection(false);
                  }}
                >
                  继续编辑
                </button>
              </>
            ) : (
              <>
                <button
                  className="marker-delete"
                  onClick={() => {
                    if (state.remove(item.id)) onClose();
                  }}
                >
                  删除
                </button>
                <button onClick={() => setConfirm(null)}>取消</button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
