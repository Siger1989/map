import { TRAVEL_MODES, normalizeTravelMode } from '../routeAnalysis/travelMode';
import { RecordedProfile } from './RecordedElevationChart';
import { RecordedDetails } from './RecordedDetails';
import { hasTrackTime } from './provenance';
import { TrackColorProfile } from './TrackColorProfile';
import { RouteAnalysisSummary } from '../routeAnalysis/RouteAnalysisSummary';
import { RoutePointSummary } from '../routeAnalysis/RoutePointSummary';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SmartInput } from '../input/SmartText';
import { useDockClearance } from './useDockClearance';
import { ComparisonEditorPositionButton } from '../mapComparison/ComparisonEditorPosition';
import { RouteSelectionFields } from './RouteSelectionFields';
import type { PointDetail } from './selectionDetails';
import type { BoxSelectionMode } from '../collections/boxSelection';
import { RoutePointMarkerFields, type PointMarkerInput } from './RoutePointMarkerFields';
import { displayedPointColor } from './displayColors';
import { resolvedRouteTerminals } from './routeTerminals';
import { RouteEndpointActions } from './RouteEndpointActions';
import { isDesktopShell } from '../platform/desktop';
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
import { formatDistance, type Coordinate, type RoutePlace } from '../navigation/types';
import type { VisiblePhoto } from '../photos/storage';
import { photosForTrack } from '../photos/trackPhotos';
import { DRAFT_ID, equalCoordinate } from './editing';
import { drawingTime } from './archive';
import { trackSourceLabel } from './provenance';
import { trackAlternatives } from './alternatives';
import { normalizeTrackStyle, TRACK_COLORS, TRACK_WIDTHS, type TrackStyle } from './style';
import type { ManualTrack } from './drawing';
import type { TrackLinePoint } from './linePoint';
import { markerChainage } from './linePoint';
import type { RouteEditSession } from './routeEdit';
import { linkedRouteMarkers, routeConnectionLabel } from './routeInfo';
import { useRouteDialogFocus } from './useRouteDialogFocus';
import type { ElevationSample } from '../journey/metrics.ts';
import { withTerrainProfileSamples } from './terrainProfileSamples.ts';
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
  onHide,
  onShare,
  onPointShare,
  onMarker,
  onPhoto,
  onDelete,
  deleteError,
  onCondition,
  onShowMetric,
  onRename,
  onAppearance,
  onSource,
  sourceName,
}: {
  track: ManualTrack;
  alternative: string;
  markers: Annotation[];
  photos: VisiblePhoto[];
  onBack: () => void;
  onHide?: () => void;
  onShare: (track: ManualTrack) => void;
  onPointShare?: (place: RoutePlace) => void;
  onMarker: (id: string) => void;
  onPhoto: (id: string) => void;
  onDelete: () => boolean;
  deleteError: string;
  onCondition: (color: string, value: string) => boolean;
  onShowMetric?: (mode: 'elevation' | 'slope') => void;
  onRename: (name: string) => boolean;
  onAppearance?: (style: TrackStyle) => boolean;
  onSource?: () => void;
  sourceName?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const [nameError, setNameError] = useState('');
  const [nameSaved, setNameSaved] = useState(false);
  const [appearanceMessage, setAppearanceMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const trackGeometryKey = JSON.stringify(track.segments);
  const [profileSnapshot, setProfileSnapshot] = useState<{
    trackId: string;
    geometryKey: string;
    lines: Coordinate[][];
    samples: ElevationSample[];
  } | null>(null);
  useEffect(() => setProfileSnapshot(null), [track.id, trackGeometryKey]);
  const onProfileSamples = (samples: ElevationSample[], profileLines: Coordinate[][]) => {
    setProfileSnapshot({ trackId: track.id, geometryKey: trackGeometryKey, lines: profileLines, samples });
  };
  const shareWithProfile = () => {
    const snapshot = profileSnapshot?.trackId === track.id && profileSnapshot.geometryKey === trackGeometryKey
      ? profileSnapshot
      : null;
    onShare(snapshot ? withTerrainProfileSamples(track, snapshot.lines, snapshot.samples) : track);
  };
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
  const [routeStart,routeEnd]=resolvedRouteTerminals(track);
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
          {onHide && (track.source === 'recorded' || hasTrackTime(track)) && (
            <button className="route-hide" aria-label={`${track.hidden ? '显示' : '隐藏'}实走行程`} title={`${track.hidden ? '显示' : '隐藏'}实走行程`} aria-pressed={!track.hidden} onClick={onHide}>
              {track.hidden ? '显示' : '隐藏'}
            </button>
          )}
          <RouteBack
            onBack={() => (confirmDelete ? setConfirmDelete(false) : onBack())}
          />
          <strong>路线详情</strong>
          <button
            className="route-solid"
            disabled={track.segments.reduce((count, line) => count + line.length, 0) < 2}
            onClick={shareWithProfile}
          >
            <Share2 size={16} />
            分享
          </button>
        </header>
        <div className="route-details-body route-details-groups">
          <section className="route-detail-group route-detail-name-group" aria-label="名称编辑">
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
          </section>
          <section className="route-detail-group route-detail-profile-group" aria-label="海拔曲线与采样点">
          {(track.source === 'recorded' || hasTrackTime(track)) ? <RecordedProfile track={track} /> : <TrackColorProfile
            track={track}
            lines={lines}
            onCondition={onCondition}
            onSamples={onProfileSamples}
          />}
          </section>
          <section className="route-detail-group route-detail-stats-group" aria-label="路线统计">
          {(track.source === 'recorded' || hasTrackTime(track)) ? <RecordedDetails track={track} /> : <p className="route-origin-note">{trackSourceLabel(track)} · 不包含实走用时、速度记录。{onSource && <button onClick={onSource}>查看实走原件：{sourceName}</button>}</p>}
          <RouteAnalysisSummary track={track} onShowMetric={onShowMetric} />
          <details className="route-detail-basic-more">
          <summary>基本资料</summary>
          <dl className="route-data-rows">
            {[
              ['来源', trackSourceLabel(track)],
              ['创建', drawingTime(track.createdAt)],
              ['更新', track.updatedAt ? drawingTime(track.updatedAt) : '—'],
              ['节点', `${new Set(track.segments.flat().map((p) => p.join(','))).size}个 · ${routeConnectionLabel(track)}`],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
          </details>
          </section>
          {onAppearance && <section className="route-detail-group route-detail-appearance-group" aria-label="整条路线外观"><h3>整条路线外观</h3><div className="route-appearance-row">{TRACK_COLORS.map((color,i) => <button key={color} aria-label={`路线${['橙色','红色','蓝色','绿色','黄色','白色'][i]}`} aria-pressed={track.style?.color === color} onClick={() => setAppearanceMessage(onAppearance({ ...normalizeTrackStyle(track.style), color, colorMode: 'solid' }) ? '路线颜色已保存' : '保存失败，请重试')}><i style={{background:color}} /></button>)}<input type="color" aria-label="自定义整条路线颜色" value={track.style?.color ?? '#ffb477'} onChange={e => setAppearanceMessage(onAppearance({...normalizeTrackStyle(track.style), color:e.target.value, colorMode:'solid'}) ? '路线颜色已保存' : '保存失败，请重试')} /></div>
            <label className="route-width-control">粗细<select aria-label="整条路线线宽" value={normalizeTrackStyle(track.style).width} onChange={e => setAppearanceMessage(onAppearance({ ...normalizeTrackStyle(track.style), width: Number(e.target.value) }) ? '路线粗细已保存' : '保存失败，请重试')}>
              {TRACK_WIDTHS.map(width => <option key={width} value={width}>{width} px</option>)}
            </select></label>
            <small role="status">{appearanceMessage || '直接保存颜色和粗细，保留原始记录。'}</small>
          <label className="route-travel-mode">出行方式<select aria-label="路线出行方式" value={normalizeTravelMode(track.style?.travelMode)} onChange={e => setAppearanceMessage(onAppearance({ ...normalizeTrackStyle(track.style), travelMode: normalizeTravelMode(e.target.value) }) ? '出行方式已保存，速度色标已更新' : '保存失败，请重试')}>
              {Object.entries(TRAVEL_MODES).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
            </select><small>用于速度配色，不改变实走数据。</small></label>
          </section>}
          <section className="route-detail-group route-detail-composition-group" aria-label="起终点与路线组成">
          <h3>起终点</h3>
          <dl className="route-data-rows">
            {[
              ['起点', track.sharedRoute?.stops[0]?.name, routeStart],
              [
                '终点',
                routeEnd ? track.sharedRoute?.stops.at(-1)?.name : undefined,
                routeEnd,
              ],
            ].map(([label, name, coordinate]) => (
              <div key={String(label)}>
                <dt>{String(label)}</dt>
                <dd>
                  {name ? <span>{String(name)}</span> : null}
                  <small className="route-endpoint-value">
                    {coordinate ? formatCoordinate(coordinate as Coordinate) : '未设置'}
                  </small>
                  {coordinate && <RouteEndpointActions routeName={track.name} label={String(label)} stopName={name ? String(name) : undefined} point={coordinate as Coordinate} onShare={onPointShare}/>}
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
          </section>
          <section className="route-detail-group route-detail-media-group" aria-label="沿途标记与关联照片">
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
          </section>
          {track.id !== DRAFT_ID && (
            <section className="route-detail-group route-detail-delete-group" aria-label="删除路线">
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
            </section>
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
  onSelectionMode,
  boxMode,
  selectedPoints,
  onSelectionDetails,
  onPointMarker,
  onSetEnd,
  onClearSelection,
  onBranch,
  onUndo,
  onStyle,
  snapping,
  roadSnapping,
  riverSnapping,
  onSnapping,
  onRoadSnapping,
  onRiverSnapping,
  onName,
}: {
  session: RouteEditSession;
  snapName?: string;
  error: string;
  onBack: (name?: string) => void;
  onSave: (name?: string) => void;
  onSaveCopy?: (name?: string) => void;
  onName: (name: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  onSelectionMode: (mode: BoxSelectionMode | null) => void;
  boxMode: BoxSelectionMode | null;
  selectedPoints: Coordinate[];
  onSelectionDetails: (detail: PointDetail) => void;
  onPointMarker: (input: PointMarkerInput) => boolean;
  onSetEnd: () => void;
  onClearSelection: () => void;
  onBranch: () => void;
  onUndo: () => void;
  onStyle: (style: TrackStyle) => void;
  snapping: boolean;
  roadSnapping: boolean;
  riverSnapping: boolean;
  onSnapping: () => void;
  onRoadSnapping: () => void;
  onRiverSnapping: () => void;
}) {
  const dock = useDockClearance('--route-edit-clearance');
  const [view, setView] = useState<'tools' | 'selection' | 'style' | 'marker'>('tools');
  const [routeName, setRouteName] = useState(session.track.name);
  const routeNameBuffer = useRef(session.track.name);
  const committedRouteName = useRef(session.track.name);
  const composingName = useRef(false);
  useEffect(() => {
    routeNameBuffer.current = session.track.name;
    committedRouteName.current = session.track.name;
    setRouteName(session.track.name);
  }, [session.track.name]);
  const selectedCount = selectedPoints.length;
  const activeView = (view === 'selection' && !selectedCount) || (view === 'marker' && selectedCount !== 1) ? 'tools' : view;
  useEffect(() => {
    if ((view === 'selection' && !selectedCount) || (view === 'marker' && selectedCount !== 1)) setView('tools');
  }, [view, selectedCount]);
  const returnToTools = () => {
    const entry = activeView === 'style' ? 'style' : 'selection';
    setView('tools');
    requestAnimationFrame(() => dock.current?.querySelector<HTMLButtonElement>(`[data-edit-entry='${entry}']:not(:disabled)`)?.focus({ preventScroll: true }));
  };
  const style = normalizeTrackStyle(session.track.style),
    branch = session.branch !== null;
  const commitRouteName = (raw = routeNameBuffer.current) => {
    const name = raw.trim().slice(0, 60);
    if (!name) {
      routeNameBuffer.current = session.track.name;
      committedRouteName.current = session.track.name;
      setRouteName(session.track.name);
      return session.track.name;
    }
    routeNameBuffer.current = name;
    setRouteName(name);
    if (name !== committedRouteName.current) {
      committedRouteName.current = name;
      onName(name);
    }
    return name;
  };
  return (
    <>
      <section
        ref={dock}
        className="route-surface route-edit-dock"
        data-app-back="10"
        data-view={activeView}
        data-style-open={activeView === 'style'}
        aria-label="路线编辑工具"
        onKeyDown={event => {
          if (event.key !== 'Escape' || event.defaultPrevented || activeView === 'tools') return;
          event.preventDefault();
          event.stopPropagation();
          returnToTools();
        }}
      >
        <header className="route-edit-dock-heading" data-edit-tools={activeView === 'tools' ? 'true' : undefined}>
          {activeView !== 'tools' && <button autoFocus aria-label="返回编辑工具" onClick={returnToTools}><ArrowLeft size={16} />返回</button>}
          {activeView === 'tools' ? <>
            <div className="route-edit-name-row">
              <input className="route-edit-name-input" aria-label="路线名称" value={routeName} maxLength={60}
                onChange={event => { routeNameBuffer.current = event.currentTarget.value; setRouteName(event.currentTarget.value); }}
                onCompositionStart={() => { composingName.current = true; }}
                onCompositionEnd={event => { composingName.current = false; routeNameBuffer.current = event.currentTarget.value; setRouteName(event.currentTarget.value); }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    routeNameBuffer.current = session.track.name;
                    committedRouteName.current = session.track.name;
                    setRouteName(session.track.name);
                    return;
                  }
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing || composingName.current) return;
                  event.preventDefault();
                  event.currentTarget.blur();
                }}
                onBlur={() => { if (!composingName.current) commitRouteName(); }} />
              <ComparisonEditorPositionButton kind="路线"/>
            </div>
            <div className="route-edit-heading-actions">
              <small>{session.history.length ? '未保存' : ''}</small>
              <button onClick={() => onBack(commitRouteName())}>退出编辑</button>
              <button className="route-solid" onClick={() => onSave(commitRouteName())}>保存并退出</button>
            </div>
          </> : <>
            <strong>{activeView === 'style' ? '线条样式' : activeView === 'marker' ? '添加标记' : `节点属性 · ${selectedCount}点`}</strong>
            <ComparisonEditorPositionButton kind="路线"/>
          </>}
        </header>
        <div className="route-edit-primary" hidden={activeView !== 'tools'}>
        <div className="route-edit-mode-row" role="group" aria-label="路线编辑方式">
          <button aria-pressed={roadSnapping} onClick={onRoadSnapping}>道路吸附</button>
          <button aria-pressed={riverSnapping} onClick={onRiverSnapping}>河道吸附</button>
          <button aria-pressed={snapping} onClick={onSnapping}>节点吸附</button>
          <button data-edit-entry="style" aria-label="线条样式" aria-expanded={activeView === 'style'} onClick={() => {onSelectionMode(null);setView('style');}}>
            <i className="route-style-chip" style={{ background: style.color }} />样式
          </button>
        </div>
        <p className="route-edit-status" role="status">
          {boxMode ? `框选${boxMode === 'add' ? '加选' : '减选'} · 已选${selectedCount}点 · 点“退出框选”恢复点选` : selectedCount ? `已选${selectedCount}点 · ${selectedCount === 1 ? '修改点颜色/备注' : '修改两端都选中的相连线段'}` : snapName
            ? `松手拼合：${snapName}`
            : session.sources.some((s) => s.id !== session.original.id)
              ? '已拼合 · 保存后成为一条路线，可撤销'
              : branch
              ? isDesktopShell()
                ? '分叉中 · 准星定点，松开鼠标连线，下方控制器平移'
                : '分叉中 · 准星定点，松手连线，双指控图'
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
            aria-label={selectedCount ? `删除选中${selectedCount}个节点` : '删除选中节点'}
            disabled={(!session.selected && !selectedCount) || branch}
            onClick={onRemove}
          >
            <Minus size={20} />
          </button>
          <button
            className="route-branch-toggle"
            aria-label={branch ? '结束分叉' : '分叉'}
            aria-pressed={branch}
            disabled={!session.selected}
            onClick={onBranch}
          >
            <GitBranch size={16} />
            {branch ? '结束' : '分叉'}
          </button>
          <button onClick={onClearSelection} disabled={!selectedCount}>清空选择</button>
          <button disabled={!session.history.length} onClick={onUndo}>
            <Undo2 size={16} />
            撤销
          </button>
        </div>
        <div className="route-selection-modes" role="group" aria-label="路线选择方式">
          <button aria-pressed={!boxMode} onClick={() => onSelectionMode(null)}>{boxMode ? '退出框选' : '点选'}</button>
          <button aria-pressed={boxMode === 'add'} disabled={branch} onClick={() => onSelectionMode('add')}>框选加</button>
          <button aria-pressed={boxMode === 'subtract'} disabled={branch} onClick={() => onSelectionMode('subtract')}>框选减</button>
          <button data-edit-entry="selection" aria-label="节点属性" disabled={!selectedCount} onClick={() => {onSelectionMode(null);setView('selection');}}>属性</button>
          <button className="route-set-endpoint" disabled={selectedCount !== 1 || branch} aria-pressed={selectedCount === 1 && !!session.track.routeTerminals?.end && equalCoordinate(selectedPoints[0],session.track.routeTerminals.end)} onClick={onSetEnd}>设终点</button>
        </div>
        </div>
        {activeView === 'selection' && <RouteSelectionFields key={`${selectedPoints.map(p => p.join(',')).join(';')}:${session.history.length}`} track={session.track} points={selectedPoints} onApply={onSelectionDetails} onMarker={()=>{onSelectionMode(null);setView('marker');}} onSetEnd={onSetEnd} />}
        {activeView === 'marker' && <RoutePointMarkerFields key={selectedPoints[0].join(',')} initial={{color:displayedPointColor(session.track,selectedPoints[0]),note:session.track.pointDetails?.[selectedPoints[0].join(',')]?.note}} onAdd={onPointMarker} onBack={()=>setView('selection')}/>}
        {activeView === 'style' && <div className="route-edit-style">
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
          <label>点径 <b>{style.pointSize ?? 8} px</b><input aria-label="轨迹点大小" type="range" min="4" max="16" step="1" value={style.pointSize ?? 8} onChange={e=>onStyle({...style,pointSize:Number(e.target.value)})}/></label>
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
            {error.includes('其他窗口更新') && onSaveCopy && <button onClick={() => onSaveCopy(commitRouteName())}>另存副本并退出</button>}
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
