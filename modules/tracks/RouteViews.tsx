import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  MapPinPlus,
  Pencil,
  Info,
  Plus,
  Minus,
  GitBranch,
  Undo2,
  Save,
  Share2,
  Box,
  Cylinder,
  Circle,
  MapPin,
  Shapes,
} from 'lucide-react';
import {
  KINDS,
  type Annotation,
  type AnnotationKind,
} from '../annotations/data';
import { formatDistance, type Coordinate } from '../navigation/types';
import type { VisiblePhoto } from '../photos/storage';
import { photosForTrack } from '../photos/trackPhotos';
import { DRAFT_ID } from './editing';
import { drawingTime } from './archive';
import { trackSourceLabel } from './provenance';
import { trackAlternatives } from './alternatives';
import { normalizeTrackStyle, TRACK_COLORS, type TrackStyle } from './style';
import type { ManualTrack } from './drawing';
import type { TrackLinePoint } from './linePoint';
import { markerChainage } from './linePoint';
import type { RouteEditSession } from './routeEdit';
import { linkedRouteMarkers, routeConnectionLabel } from './routeInfo';
import { useRouteDialogFocus } from './useRouteDialogFocus';
import './routeWindows.css';

function useDockClearance(variable: string) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const dock = ref.current,
      root = dock?.closest('main');
    if (!dock || !root) return;
    const update = () =>
      root.style.setProperty(
        variable,
        `${Math.ceil(dock.getBoundingClientRect().height) + 24}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    update();
    return () => {
      observer.disconnect();
      root.style.removeProperty(variable);
    };
  }, [variable]);
  return ref;
}

export function RouteBack({ onBack }: { onBack: () => void }) {
  return (
    <button className="route-back" onClick={onBack}>
      <ArrowLeft size={16} />
      返回
    </button>
  );
}
export function RouteCard({
  track,
  point,
  altitude,
  alternative,
  error,
  onBack,
  onNavigate,
  onMarker,
  onEdit,
  onDetails,
}: {
  track: ManualTrack;
  point: TrackLinePoint | null;
  altitude: number | null;
  alternative: string;
  error: string;
  onBack: () => void;
  onNavigate: () => void;
  onMarker: () => void;
  onEdit: () => void;
  onDetails: () => void;
}) {
  const dock = useDockClearance('--route-card-clearance');
  const choices = trackAlternatives(track.segments),
    choice = choices.find((v) => v.id === alternative) ?? choices[0];
  const selected =
    point && choice
      ? markerChainage([choice.coordinates], point.coordinate)
      : null;
  return (
    <section
      ref={dock}
      className="route-surface route-card"
      aria-label="所选路线"
    >
      <header>
        <RouteBack onBack={onBack} />
        <strong title={track.name}>{track.name}</strong>
        <small>{track.id === DRAFT_ID ? '草稿' : '已保存'}</small>
      </header>
      <div className="route-card-info">
        <span>
          {choice?.label ?? '路线'}{' '}
          {choice ? formatDistance(choice.distance) : '—'}
        </span>
        <span>
          {selected
            ? `选中 ${formatDistance(selected.distance)}`
            : '点线选位置'}
        </span>
        <span>
          海拔{' '}
          {altitude === null
            ? '—'
            : `${Math.round(altitude).toLocaleString()} m`}
        </span>
      </div>
      <nav className="route-primary-actions" aria-label="路线主要操作">
        <button className="route-solid" onClick={onNavigate}>
          <ArrowUpRight size={16} />
          导航
        </button>
        <button disabled={!point} onClick={onMarker}>
          <MapPinPlus size={16} />
          添加标记
        </button>
        <button onClick={onEdit}>
          <Pencil size={16} />
          编辑
        </button>
        <button onClick={onDetails}>
          <Info size={16} />
          详情
        </button>
      </nav>
      {error && (
        <p role="alert" className="route-window-error">
          {error}
        </p>
      )}
    </section>
  );
}
const formatCoordinate = (p: Coordinate | undefined) =>
  p
    ? `${Math.abs(p[1]).toFixed(5)}°${p[1] < 0 ? 'S' : 'N'}，${Math.abs(p[0]).toFixed(5)}°${p[0] < 0 ? 'W' : 'E'}`
    : '—';
export function RouteDetails({
  track,
  alternative,
  markers,
  photos,
  onBack,
  onShare,
  onMarker,
  onPhoto,
  onDelete,
  deleteError,
}: {
  track: ManualTrack;
  alternative: string;
  markers: Annotation[];
  photos: VisiblePhoto[];
  onBack: () => void;
  onShare: () => void;
  onMarker: (id: string) => void;
  onPhoto: (id: string) => void;
  onDelete: () => boolean;
  deleteError: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const root = useRouteDialogFocus(() =>
    confirmDelete ? setConfirmDelete(false) : onBack(),
  );
  const variants = useMemo(
    () =>
      trackAlternatives(track.segments, normalizeTrackStyle(track.style).color),
    [track.segments, track.style],
  );
  const current = variants.find((v) => v.id === alternative) ?? variants[0];
  const lines = current ? [current.coordinates] : track.segments;
  const linked = linkedRouteMarkers(track, markers)
    .map((marker) => ({ marker, ...markerChainage(lines, marker.coordinates) }))
    .sort((a, b) => a.distance - b.distance);
  const pictures = photosForTrack(track, photos);
  return (
    <div className="route-window-backdrop">
      <section
        ref={root}
        className="route-surface route-details"
        role="dialog"
        aria-modal="true"
        aria-label="路线详情"
      >
        <header>
          <RouteBack
            onBack={() => (confirmDelete ? setConfirmDelete(false) : onBack())}
          />
          <strong>路线详情</strong>
          <button
            className="route-solid"
            disabled={track.id === DRAFT_ID}
            onClick={onShare}
          >
            <Share2 size={16} />
            分享
          </button>
        </header>
        <div className="route-details-body">
          <h2>{track.name}</h2>
          <h3>基本资料</h3>
          <dl className="route-data-rows">
            {[
              ['来源', trackSourceLabel(track)],
              ['创建', drawingTime(track.createdAt)],
              ['更新', track.updatedAt ? drawingTime(track.updatedAt) : '—'],
              [
                '节点',
                `${new Set(track.segments.flat().map((p) => p.join(','))).size}个 · ${routeConnectionLabel(track)}`,
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>起终点</h3>
          <dl className="route-data-rows">
            {[
              ['起点', track.sharedRoute?.stops[0]?.name, lines[0]?.[0]],
              [
                '终点',
                track.sharedRoute?.stops.at(-1)?.name,
                lines.at(-1)?.at(-1),
              ],
            ].map(([label, name, coordinate]) => (
              <div key={String(label)}>
                <dt>{String(label)}</dt>
                <dd>
                  {name ? <span>{String(name)}</span> : null}
                  <small>
                    {formatCoordinate(coordinate as Coordinate | undefined)}
                  </small>
                </dd>
              </div>
            ))}
          </dl>
          <h3>路线组成</h3>
          <div className="route-composition">
            {variants.map((v) => (
              <div key={v.id}>
                <i style={{ background: v.color }} />
                <span>{v.label}</span>
                <span>
                  {formatDistance(v.distance)}
                  {v.id !== 'main' ? ' · 替代中间路段' : ''}
                </span>
              </div>
            ))}
          </div>
          <h3>沿途标记 · {linked.length}个</h3>
          <div className="route-detail-markers">
            {linked.length ? (
              linked.map(({ marker, distance, offset }) => (
                <button key={marker.id} onClick={() => onMarker(marker.id)}>
                  <MapPin size={16} color={marker.color} />
                  <span>{marker.name || '未命名标记'}</span>
                  <small>
                    {offset > 30 ? '其他路段' : formatDistance(distance)}
                  </small>
                </button>
              ))
            ) : (
              <p>暂无关联标记</p>
            )}
          </div>
          <h3>关联照片 · {pictures.length}张</h3>
          <div className="route-detail-photos">
            {pictures.length ? (
              pictures.map((p) => (
                <button key={p.id} onClick={() => onPhoto(p.id)}>
                  <img src={p.url} alt={p.title || p.name} />
                  <small>
                    {new Date(p.time).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </button>
              ))
            ) : (
              <p>暂无关联照片</p>
            )}
          </div>
          {track.id !== DRAFT_ID && (
            <div className="route-delete-area">
              {confirmDelete ? (
                <>
                  <strong>删除“{track.name}”？</strong>
                  <p>
                    此路线将从地图和收藏移除。关联照片、标记及来源路线保留。
                  </p>
                  <div>
                    <button onClick={() => setConfirmDelete(false)}>
                      取消
                    </button>
                    <button className="route-danger" onClick={onDelete}>
                      确认删除路线
                    </button>
                  </div>
                  {deleteError && <p role="alert">{deleteError}</p>}
                </>
              ) : (
                <button
                  className="route-danger"
                  onClick={() => setConfirmDelete(true)}
                >
                  删除路线
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
export function RouteEditToolbar({
  session,
  error,
  onBack,
  onSave,
  onAdd,
  onRemove,
  onBoxSelect,
  onBranch,
  onUndo,
  onStyle,
  snapping,
  roadSnapping,
  onSnapping,
  onRoadSnapping,
}: {
  session: RouteEditSession;
  error: string;
  onBack: () => void;
  onSave: () => void;
  onAdd: () => void;
  onRemove: () => void;
  onBoxSelect: () => void;
  onBranch: () => void;
  onUndo: () => void;
  onStyle: (style: TrackStyle) => void;
  snapping: boolean;
  roadSnapping: boolean;
  onSnapping: () => void;
  onRoadSnapping: () => void;
}) {
  const dock = useDockClearance('--route-edit-clearance');
  const style = normalizeTrackStyle(session.track.style),
    branch = session.branch !== null;
  return (
    <>
      <header className="route-surface route-edit-header">
        <RouteBack onBack={onBack} />
        <strong>编辑路线</strong>
        <small>{session.history.length ? '未保存' : '可编辑'}</small>
      </header>
      <section
        ref={dock}
        className="route-surface route-edit-dock"
        aria-label="路线编辑工具"
      >
        <p className="route-edit-status" role="status">
          {branch
            ? '分叉中 · 准星定点，松手连线，双指控图'
            : session.selected
              ? '已选节点 · 直接拖动调整位置'
              : '点选节点调整，或点线段后添加节点'}
        </p>
        <div
          className="route-edit-actions-row"
          role="toolbar"
          aria-label="节点编辑"
        >
          <button aria-label="添加中间节点" disabled={branch} onClick={onAdd}>
            <Plus size={20} />
          </button>
          <button
            aria-label="删除选中节点"
            disabled={!session.selected || branch}
            onClick={onRemove}
          >
            <Minus size={20} />
          </button>
          <button
            aria-pressed={branch}
            disabled={!session.selected}
            onClick={onBranch}
          >
            <GitBranch size={16} />
            {branch ? '结束分叉' : '分叉'}
          </button>
          <button onClick={onBoxSelect} disabled={branch || !session.track.segments.length} aria-label="框选路线点">框选</button>
          <button disabled={!session.history.length} onClick={onUndo}>
            <Undo2 size={16} />
            撤销
          </button>
          <button className="route-solid" onClick={onSave}>
            <Save size={16} />
            保存
          </button>
        </div>
        {branch && (
          <div className="route-branch-options">
            <button aria-pressed={roadSnapping} onClick={onRoadSnapping}>
              道路{roadSnapping ? '吸附' : '自由'}
            </button>
            <button aria-pressed={snapping} onClick={onSnapping}>
              节点吸附
            </button>
          </div>
        )}
        <div className="route-edit-colors" role="group" aria-label="轨迹颜色">
          {TRACK_COLORS.map((color, i) => (
            <button
              key={color}
              aria-label={['橙色', '红色', '蓝色', '绿色', '黄色', '白色'][i]}
              aria-pressed={style.color === color}
              onClick={() => onStyle({ ...style, color })}
            >
              <i style={{ background: color }} />
            </button>
          ))}
          <label className="route-custom-color">
            自定
            <input
              aria-label="自定义轨迹颜色"
              type="color"
              value={style.color}
              onChange={(e) => onStyle({ ...style, color: e.target.value })}
            />
          </label>
        </div>
        <div className="route-edit-sliders">
          <label>
            线宽 <b>{style.width} px</b>
            <input
              aria-label="轨迹线宽"
              type="range"
              min="0.5"
              max="5"
              step="0.5"
              value={style.width}
              onChange={(e) =>
                onStyle({ ...style, width: Number(e.target.value) })
              }
            />
          </label>
          <label>
            透明度 <b>{Math.round((1 - (style.opacity ?? 1)) * 100)}%</b>
            <input
              aria-label="轨迹透明度"
              type="range"
              min="0"
              max="90"
              step="5"
              value={Math.round((1 - (style.opacity ?? 1)) * 100)}
              onChange={(e) =>
                onStyle({ ...style, opacity: 1 - Number(e.target.value) / 100 })
              }
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="route-window-error">
            {error}
          </p>
        )}
      </section>
    </>
  );
}
export function RouteMarkerTypes({
  onBack,
  onAdd,
  error,
}: {
  onBack: () => void;
  onAdd: (kind: AnnotationKind) => void;
  error: string;
}) {
  const root = useRouteDialogFocus(onBack);
  const icons = {
    pin: MapPinPlus,
    box: Box,
    cylinder: Cylinder,
    sphere: Circle,
    prism: Shapes,
  };
  return (
    <div className="route-window-backdrop">
      <section
        ref={root}
        className="route-surface route-marker-picker"
        role="dialog"
        aria-modal="true"
        aria-label="选择标记类型"
      >
        <header>
          <RouteBack onBack={onBack} />
          <strong>添加标记</strong>
        </header>
        <p>标在路线绿色点的位置</p>
        <div>
          {(Object.keys(KINDS) as AnnotationKind[]).map((kind) => {
            const Icon = icons[kind];
            return (
              <button key={kind} onClick={() => onAdd(kind)}>
                <Icon size={20} />
                {KINDS[kind]}
              </button>
            );
          })}
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
    </div>
  );
}
export function RouteUnsavedDialog({
  onSave,
  onDiscard,
  onContinue,
}: {
  onSave: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}) {
  const root = useRouteDialogFocus(onContinue);
  return (
    <div className="route-window-backdrop route-unsaved-backdrop">
      <section
        ref={root}
        className="route-surface route-unsaved"
        role="dialog"
        aria-modal="true"
        aria-label="尚未保存的路线编辑"
      >
        <header>
          <RouteBack onBack={onContinue} />
          <strong>本次修改尚未保存</strong>
        </header>
        <p>保存后返回路线，或放弃本次修改。</p>
        <div>
          <button className="route-solid" onClick={onSave}>
            保存并返回
          </button>
          <button onClick={onDiscard}>放弃本次修改</button>
          <button onClick={onContinue}>继续编辑</button>
        </div>
      </section>
    </div>
  );
}
