import { TRAVEL_MODES, normalizeTravelMode } from '../routeAnalysis/travelMode';
import { RecordedProfile } from './RecordedElevationChart';
import { RecordedDetails } from './RecordedDetails';
import { hasTrackTime } from './provenance';
import { TrackColorProfile } from './TrackColorProfile';
import { RouteAnalysisSummary } from '../routeAnalysis/RouteAnalysisSummary';
import { RoutePointSummary } from '../routeAnalysis/RoutePointSummary';
import { useMemo, useState } from 'react';
import { SmartInput } from '../input/SmartText';
import { useDockClearance } from './useDockClearance';
import {
  ArrowLeft,
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
  type AnnotationChoice,
} from '../annotations/data';
import { AnnotationTypeOptions } from '../annotations/AnnotationTypeOptions';
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

export function RouteBack({ onBack }: { onBack: () => void }) {
  return (
    <button className="route-back" onClick={onBack}>
      <ArrowLeft size={16} />
      返回
    </button>
  );
}
export { HomeRouteCard as RouteCard } from './HomeRouteCard';
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
  onCondition,
  onShowMetric,
  onRename,
  onOffline,
  onAppearance,
  onSource,
  sourceName,
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
  onCondition: (color: string, value: string) => boolean;
  onShowMetric?: (mode: 'elevation' | 'slope') => void;
  onRename: (name: string) => boolean;
  onOffline?: () => void;
  onAppearance?: (style: TrackStyle) => boolean;
  onSource?: () => void;
  sourceName?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');
  const [nameSaved, setNameSaved] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState('');
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
          <form className="route-details-name" aria-label="修改路线名称" onSubmit={(event) => {
            event.preventDefault();
            const value = (name ?? track.name).trim();
            setNameSaved(false);
            if (!value) { setNameError('请输入路线名称'); return; }
            if (!onRename(value)) { setNameError('名称未保存，请重试；输入已保留。'); return; }
            setName(null);
            setNameError('');
            setNameSaved(true);
          }}>
            <label htmlFor="route-details-name">路线名称</label>
            <SmartInput id="route-details-name" value={name ?? track.name} maxLength={60}
              onChange={(event) => { setName(event.target.value); setNameError(''); setNameSaved(false); }} />
            <div>
              <button type="button" onClick={() => { setName(null); setNameError(''); setNameSaved(false); }}>取消修改</button>
              <button type="submit" className="route-solid">保存名称</button>
            </div>
            {nameError && <p role="alert">{nameError}</p>}
            {nameSaved && <p role="status">名称已保存</p>}
          </form>
          {onOffline && <button onClick={onOffline}>下载沿线地图</button>}
          {(track.source === 'recorded' || hasTrackTime(track)) ? <RecordedDetails track={track} /> : <p className="route-origin-note">{trackSourceLabel(track)} · 不包含实走用时、速度记录。{onSource && <button onClick={onSource}>查看实走原件：{sourceName}</button>}</p>}
          {onAppearance && <section aria-label="整条路线外观"><h3>整条路线颜色</h3><div className="route-appearance-row">{TRACK_COLORS.map((color,i) => <button key={color} aria-label={`路线${['橙色','红色','蓝色','绿色','黄色','白色'][i]}`} aria-pressed={track.style?.color === color} onClick={() => setAppearanceMessage(onAppearance({ ...normalizeTrackStyle(track.style), color, colorMode: 'solid' }) ? '路线颜色已保存' : '保存失败，请重试')}><i style={{background:color}} /></button>)}<input type="color" aria-label="自定义整条路线颜色" value={track.style?.color ?? '#ffb477'} onChange={e => setAppearanceMessage(onAppearance({...normalizeTrackStyle(track.style), color:e.target.value, colorMode:'solid'}) ? '路线颜色已保存' : '保存失败，请重试')} /></div><small role="status">{appearanceMessage || '直接保存颜色，保留原始记录。'}</small></section>}
          {onAppearance && <label className="route-travel-mode">出行方式<select aria-label="路线出行方式" value={normalizeTravelMode(track.style?.travelMode)} onChange={e => setAppearanceMessage(onAppearance({ ...normalizeTrackStyle(track.style), travelMode: normalizeTravelMode(e.target.value) }) ? '出行方式已保存，速度色标已更新' : '保存失败，请重试')}>{Object.entries(TRAVEL_MODES).map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select><small>用于速度配色，不改变实走数据。</small></label>}
          <RouteAnalysisSummary track={track} onShowMetric={onShowMetric} />
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
          {(track.source === 'recorded' || hasTrackTime(track)) ? <RecordedProfile track={track} /> : <TrackColorProfile
            track={track}
            lines={lines}
            onCondition={onCondition}
          />}
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
  snapName,
  error,
  onBack,
  onSave,
  onSaveCopy,
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
  snapName?: string;
  error: string;
  onBack: () => void;
  onSave: () => void;
  onSaveCopy?: () => void;
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
  const [showStyle, setShowStyle] = useState(false);
  const style = normalizeTrackStyle(session.track.style),
    branch = session.branch !== null;
  return (
    <>
      <section
        ref={dock}
        className="route-surface route-edit-dock"
        data-style-open={showStyle}
        aria-label="路线编辑工具"
      >
        <header className="route-edit-dock-heading">
          <strong>编辑路线</strong><small>{session.history.length ? '未保存' : ''}</small>
          <button onClick={onBack}>退出编辑</button>
          <button className="route-solid" onClick={onSave}>保存并退出</button>
        </header>
        <p className="route-edit-status" role="status">
          {snapName
            ? `松手拼合：${snapName}`
            : session.sources.some((s) => s.id !== session.original.id)
              ? '已拼合 · 保存后成为一条路线，可撤销'
              : branch
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
            className="route-branch-toggle"
            aria-pressed={branch}
            disabled={!session.selected}
            onClick={onBranch}
          >
            <GitBranch size={16} />
            {branch ? '结束分叉' : '分叉'}
          </button>
          <button
            onClick={onBoxSelect}
            disabled={branch || !session.track.segments.length}
            aria-label="框选路线点"
          >
            框选
          </button>
          <button disabled={!session.history.length} onClick={onUndo}>
            <Undo2 size={16} />
            撤销
          </button>
        </div>
        {
          <div className="route-branch-options">
            {branch && (
              <button aria-pressed={roadSnapping} onClick={onRoadSnapping}>
                道路{roadSnapping ? '吸附' : '自由'}
              </button>
            )}
            <button aria-pressed={snapping} onClick={onSnapping}>
              节点吸附
            </button>
            <button aria-expanded={showStyle} onClick={() => setShowStyle(!showStyle)}>
              <i className="route-style-chip" style={{ background: style.color }} />路线颜色 {showStyle ? '收起' : '展开'}
            </button>
          </div>
        }
        {showStyle && <div className="route-edit-style">
        <div className="route-edit-colors" role="group" aria-label="轨迹颜色">
          {TRACK_COLORS.map((color, i) => (
            <button
              key={color}
              aria-label={['橙色', '红色', '蓝色', '绿色', '黄色', '白色'][i]}
              aria-pressed={style.color === color}
              onClick={() => onStyle({ ...style, color, colorMode: 'solid' })}
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
              onChange={(e) => onStyle({ ...style, color: e.target.value, colorMode: 'solid' })}
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
        </div>}
        {error && (
          <p role="alert" className="route-window-error">
            {error}
            {error.includes('其他窗口更新') && onSaveCopy && <button onClick={onSaveCopy}>另存副本并退出</button>}
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
  onAdd: (kind: AnnotationChoice) => void;
  error: string;
}) {
  const root = useRouteDialogFocus(onBack);
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
          <AnnotationTypeOptions onAdd={onAdd} />
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
        <p>保存并退出会保留修改；继续编辑不保存、不退出。</p>
        <div>
          <button className="route-solid" onClick={onSave}>
            保存并退出
          </button>
          <button onClick={onDiscard}>不保存并退出</button>
          <button onClick={onContinue}>继续编辑</button>
        </div>
      </section>
    </div>
  );
}
