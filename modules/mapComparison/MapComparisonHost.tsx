import { cloneElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { MapHandle, TerrainMapProps } from '../map/TerrainMap';
import type { CameraSnapshot } from '../controls/useMapFocusLock';
import type { ComparisonChoice } from './choices';
import type { Coordinate } from '../navigation/types';
import { formatDistance, formatDuration } from '../navigation/types';
import { RouteNameInput } from '../navigation/RouteNameInput';
import type { ViewState } from '../map/types';
import { applyLayerPatch, type LayerSettings } from '../map/types';
import type { SatelliteState } from '../satellite/satellite';
import { ComparisonLayerWindow } from './ComparisonLayerWindow';
import { CameraGizmo } from '../controls/CameraGizmo';
import { FullscreenButton } from '../controls/FullscreenButton';
import { ComparisonEditorPosition } from './ComparisonEditorPosition';
import { Plus, Minus, LocateFixed, MapPinPlus, Layers, SlidersHorizontal, Undo2, Check, Pause, X, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';
import { PencilIcon } from '@heroicons/react/24/solid';
import type { AnnotationChoice } from '../annotations/data';
import { DirectionControl } from '../position/DirectionControl';
import type { DirectionMode } from '../position/types';
import type { TrackStyle } from '../tracks/style';
import type { DrawingInput } from '../tracks/DrawingGestureBridge';
import { ComparisonLineProperties } from './ComparisonProperties';
import { ComparisonSourceSelector } from './ComparisonSourceSelector';
import { comparisonSourceGroups, readComparisonSourceOpenGroups, subscribeComparisonSourceOpenGroups, visibleComparisonSourceChoices, type ComparisonSourceGroupName } from './comparisonSourceGroups';
import { readFavoriteSourceKeys, subscribeFavoriteSourceKeys } from '../mapSources/favorites';
import './mapComparison.css';

export type ComparisonSession = { choices: ComparisonChoice[]; camera: CameraSnapshot };
type Props = {
  session: ComparisonSession | null;
  primary: RefObject<MapHandle | null>;
  onClose: () => void;
  onUse: (choice: ComparisonChoice) => void;
  view?: ViewState;
  search?: ReactNode;
  onDrawingInput?: (index: 0 | 1, event: DrawingInput) => void;
  drawingOverlay?: (index: 0 | 1, map: RefObject<MapHandle | null>) => ReactNode;
  editorPaneOverlay?: (index: 0 | 1, map: RefObject<MapHandle | null>) => ReactNode;
  markerEditor?: (onClose: () => void) => ReactNode;
  editorOverlay?: ReactNode;
  editorDialog?: ReactNode;
  plannedRoute?: {
    name: string;
    onRename: (name: string) => boolean;
    visible: boolean;
    onToggleVisible: () => void;
    distance: number;
    duration: number;
    onEdit: () => void;
    onShow: () => void;
    onDetails: () => void;
    onClose: () => void;
  } | null;
  operations?: {
    onMark: (point: Coordinate, kind: AnnotationChoice) => boolean;
    onOutline?: () => void;
    onDraw: () => void;
    onUndo: () => void;
    onSave: () => boolean;
    onPause: () => void;
    onLocate: () => void;
    following: boolean;
    tracking?: boolean;
    locating?: boolean;
    locationError?: string;
    followBlocked?: boolean;
    onToggleFollowing: () => void;
    direction: DirectionMode;
    directionStatus?: string;
    onDirectionChange: (mode: DirectionMode) => void;
    canUndo: boolean;
    drawingEnabled?: boolean;
    snapping: boolean;
    onSnappingChange: (enabled: boolean) => void;
    roadSnapping: boolean;
    onRoadSnappingChange: (enabled: boolean) => void;
    riverSnapping: boolean;
    onRiverSnappingChange: (enabled: boolean) => void;
    error: string;
    style?: TrackStyle;
    onStyle?: (style: TrackStyle) => void;
    onSelectMarker?: (id: string) => boolean;
    selectedTrack?: { id: string; name: string } | null;
    onEditSelectedTrack?: () => void;
    onDeleteSelectedTrack?: () => boolean;
    editingTrack?: boolean;
    onBackEditor?: () => void;
  };
  children: ReactElement<TerrainMapProps>;
};
const noop = () => {};

/** The primary map remains mounted in its original DOM position during comparison. */
export function MapComparisonHost({ session, primary, onClose, onUse, children, operations, view, search, onDrawingInput, drawingOverlay, editorPaneOverlay, markerEditor, editorOverlay, editorDialog, plannedRoute }: Props) {
  const secondary = useRef<MapHandle | null>(null);
  const camera = useRef<CameraSnapshot | null>(null);
  const secondaryReady = useRef(false);
  const previous = useRef<ComparisonSession | null>(null);
  const [selected, setSelected] = useState<[string, string]>(['current', 'sentinel']);
  const [favoriteSourceKeys, setFavoriteSourceKeys] = useState(readFavoriteSourceKeys);
  const [sourceOpenGroups, setSourceOpenGroups] = useState<ComparisonSourceGroupName[]>(readComparisonSourceOpenGroups);
  const [confirmDeleteTrackId, setConfirmDeleteTrackId] = useState<string | null>(null);
  const [status, setStatus] = useState<[string, string]>(['', '']);
  const [mode, setMode] = useState<'browse' | 'draw'>('browse');
  const [properties, setProperties] = useState<'line' | 'marker' | null>(null);
  const [notice, setNotice] = useState('');
  const followTimer = useRef<number | null>(null);
  const lastFollowClick = useRef(0);
  const [layerPane, setLayerPane] = useState<0 | 1 | null>(null);
  const [paneSettings, setPaneSettings] = useState<[Record<string, LayerSettings>, Record<string, LayerSettings>]>([{}, {}]);
  const [satellite, setSatellite] = useState<[SatelliteState | null, SatelliteState | null]>([null, null]);
  const layerToggle = useRef<HTMLButtonElement>(null);
  const sourceControls = useRef<[HTMLButtonElement | null, HTMLButtonElement | null]>([null, null]);
  const [landscape, setLandscape] = useState(false);
  const [editorPane, setEditorPane] = useState<0 | 1>(1);
  const close = useRef<HTMLButtonElement>(null);
  const followTracking = operations?.tracking ?? operations?.following ?? false;
  const followLocating = operations?.locating ?? false;
  const followError = operations?.locationError ?? '';
  const followStatus = mode === 'browse'
    ? followError || (followLocating ? '正在获取有效定位…' : '')
    : '';
  // A new session uses the currently displayed camera/source, including wrapped worlds.
  if (previous.current !== session) {
    previous.current = session;
    camera.current = session?.camera ?? null;
    secondaryReady.current = false;
  }
  useEffect(() => {
    if (!session) return;
    setSelected(['current', session.choices[0].settings.satellite && !session.choices[0].source ? 'terrain' : 'sentinel']);
    setStatus(['', '']);
    setMode('browse');
    setProperties(null);
    setNotice('');
    setLayerPane(null);
    setPaneSettings([{}, {}]);
    setSatellite([null, null]);
    setEditorPane(1);
    close.current?.focus({ preventScroll: true });
  }, [session]);
  useEffect(() => () => {
    if (followTimer.current !== null) window.clearTimeout(followTimer.current);
  }, []);
  useEffect(() => subscribeFavoriteSourceKeys(setFavoriteSourceKeys), []);
  useEffect(() => subscribeComparisonSourceOpenGroups(setSourceOpenGroups), []);
  useEffect(() => {
    if (mode === 'draw' && operations?.drawingEnabled === false) {
      setMode('browse');
      setNotice('');
    }
  }, [mode, operations?.drawingEnabled]);
  useEffect(() => {
    const media = window.matchMedia?.('(orientation: landscape)');
    if (!media) return;
    const update = () => setLandscape(media.matches);
    update();
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener?.(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener?.(update);
    };
  }, []);
  const side = (index: 0 | 1) => landscape
    ? index === 0 ? '左' : '右'
    : index === 0 ? '上' : '下';
  const synchronize = (from: 0 | 1, next: CameraSnapshot) => {
    // The new pane emits a camera while loading its style/terrain, before onReady.
    // It must adopt the live primary view first, not reset the primary to that view.
    if (from === 1 && !secondaryReady.current) return;
    camera.current = next;
    (from === 0 ? secondary : primary).current?.applyCamera(next);
  };
  const choices = useMemo(() => ([0, 1] as const).map(index => {
    const item = session?.choices.find(item => item.id === selected[index]) ?? session?.choices[0];
    return item && paneSettings[index][item.id] ? { ...item, settings: paneSettings[index][item.id] } : item;
  }), [session, selected, paneSettings]);
  const choice = (index: 0 | 1) => choices[index]!;
  const changeLayers = (index: 0 | 1, patch: Partial<LayerSettings>) => {
    const item = choice(index);
    setPaneSettings(old => {
      const next: typeof old = [...old];
      next[index] = { ...old[index], [item.id]: applyLayerPatch(old[index][item.id] ?? item.settings, patch) };
      return next;
    });
    if (patch.terrain !== undefined) (index === 0 ? primary : secondary).current?.setTerrainMode(patch.terrain);
  };
  const closeLayers = () => { setLayerPane(null); layerToggle.current?.focus({ preventScroll: true }); };
  const enableTerrain = (pitch: number) => {
    if (pitch <= 0) return;
    changeLayers(0, { terrain: true });
    changeLayers(1, { terrain: true });
  };
  const report = (index: 0 | 1, message: string) => setStatus(old => old[index] === message ? old : index === 0 ? [message, old[1]] : [old[0], message]);
  const select = (index: 0 | 1, id: string) => {
    setSelected(old => index === 0 ? [id, old[1]] : [old[0], id]);
    setSatellite(old => index === 0 ? [null, old[1]] : [old[0], null]);
    report(index, '正在加载地图…');
  };
  const step = (index: 0 | 1, direction: -1 | 1) => {
    const groups = comparisonSourceGroups(session!.choices, favoriteSourceKeys);
    const items = visibleComparisonSourceChoices(groups, sourceOpenGroups);
    if (!items.length) return;
    const current = items.findIndex(item => item.id === choice(index).id);
    const next = current < 0 ? direction > 0 ? 0 : items.length - 1 : (current + direction + items.length) % items.length;
    select(index, items[next].id);
  };
  const canStepSource = session ? visibleComparisonSourceChoices(
    comparisonSourceGroups(session.choices, favoriteSourceKeys), sourceOpenGroups,
  ).length > 0 : false;
  const pause = () => { if (mode === 'draw') operations?.onPause(); setMode('browse'); setNotice(''); };
  const finish = (action: () => void) => { pause(); setProperties(null); setLayerPane(null); action(); };
  const markCenter = (kind: AnnotationChoice) => {
    if (kind === 'prism' && operations?.onOutline) {
      operations.onOutline();
      setNotice('轮廓绘制已开启');
      return;
    }
    const center = primary.current?.centerCoordinate() ?? camera.current?.center;
    if (center && operations?.onMark(center, kind)) { setNotice('地点标记已添加，可编辑'); setProperties('marker'); }
    else setNotice('标记未保存，请检查存储或数量');
  };
  const selectMarker = (id: string) => {
    if (operations?.onSelectMarker?.(id)) setProperties('marker');
  };
  const mapProps = (index: 0 | 1): Partial<TerrainMapProps> => ({
    mapSource: choice(index).source,
    settings: choice(index).settings,
    className: index === 0 ? 'map-comparison-primary' : 'map-comparison-secondary',
    readOnly: !operations,
    queryOnPick: false,
    onPoint: noop,
    // A route branch edit uses the existing TrackDrawing gesture bridge while
    // comparison remains in browse mode. Preserve that explicitly requested
    // branch gesture on both panes; ordinary route editing stays in hit-test mode.
    drawingActive: (mode === 'draw' && operations?.drawingEnabled !== false) ||
      (!!operations?.editingTrack && children.props.drawingActive === true),
    // Browse mode must let TerrainMap run its normal track/route hit tests.
    // Marker selection has its own annotationPicking path above.
    pickingActive: false,
    sectionEditing: false,
    annotationPicking: mode === 'browse' && !operations?.editingTrack,
    measurementPicking: false,
    onMapPick: coordinates => children.props.onMapPick(coordinates),
    onRouteSelect: () => {
      setLayerPane(null);
      setProperties(null);
      children.props.onRouteSelect?.();
    },
    onDrawingInput: event => onDrawingInput?.(index, event),
    onMapHold: noop,
    onAnnotationSelect: selectMarker,
    onDragBegin: target => {
      setProperties(null);
      setLayerPane(null);
      children.props.onDragBegin(target);
    },
    onAnnotationNavigate: noop,
    onPhotoSelect: noop,
    collectionPreviewActive: false,
    onCameraChange: value => synchronize(index, value),
    // Share transient geometry directly; do not rerender the whole page for
    // every drag frame or invoke the other pane's gesture callback recursively.
    onTrackPreview: preview => {
      children.props.onTrackPreview?.(preview);
      (index === 0 ? secondary : primary).current?.previewTrackNode?.(preview);
    },
    onReady: () => {
      if (camera.current) (index === 0 ? primary : secondary).current?.applyCamera(camera.current);
      if (index === 1) secondaryReady.current = true;
    },
    onSourceStatus: message => report(index, message),
    onStatus: message => report(index, message),
    onSatellite: value => setSatellite(old => index === 0 ? [value, old[1]] : [old[0], value]),
  });
  // Selection can disappear after deleting a marker; its host must disappear too.
  const markerWorkspace = properties === 'marker' ? markerEditor?.(() => setProperties(null)) : null;
  const editorPosition = useMemo(() => ({ pane: editorPane, landscape,
    toggle: () => setEditorPane(pane => pane === 0 ? 1 : 0),
  }), [editorPane, landscape]);
  return <>
    {cloneElement(children, session ? mapProps(0) : {})}
    {session && <>
      {cloneElement(children, {
        ...mapProps(1),
        // React's special ref is not part of the map's business props.
        ref: secondary,
        persistCamera: false,
        initialCamera: session.camera,
        onView: noop, onCenter: noop, onPoint: noop,
        onGeology: noop, onSectionStatus: noop,
        onSectionChange: noop, onSectionProfile: noop, onModelTerrainStatus: noop,
      } as Partial<TerrainMapProps> & { ref: RefObject<MapHandle | null> })}
      <section className="map-comparison-ui" aria-label="双图源对比" data-app-back="30" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (layerPane !== null) closeLayers(); else if (properties) setProperties(null); else if (operations?.editingTrack) operations.onBackEditor?.(); else if (mode !== 'browse') pause(); else if (plannedRoute) plannedRoute.onClose(); else finish(onClose); }
      }}>
        <header className="map-comparison-heading">
          <strong>对比</strong>{search}
          <span className="map-comparison-live" role="status" aria-live="polite">{mode === 'draw' ? '标准轨迹绘制已开启' : followStatus || notice || '十字定位 · 双向同步'}</span>
          <FullscreenButton compact />
          <button ref={layerToggle} className="map-comparison-heading-icon" aria-label="对比图层" title="图层" aria-expanded={layerPane !== null} aria-controls={layerPane !== null ? 'comparison-layer-window' : undefined} onClick={() => { setLayerPane(layerPane === null ? 0 : null); setProperties(null); }}><Layers size={18}/></button>
          <button className="map-comparison-heading-icon" aria-label="画线属性" title="画线属性" aria-expanded={properties === 'line'} onClick={() => { setLayerPane(null); setProperties(properties === 'line' ? null : 'line'); }}><SlidersHorizontal size={18}/></button>
          <button className="map-comparison-heading-icon" ref={close} onClick={() => finish(onClose)} aria-label="退出双图源对比" title="退出对比"><X size={20}/></button>
        </header>
        <div className="map-comparison-panes">
          {([0, 1] as const).map(index => <section key={index} className="map-comparison-pane" aria-label={`${side(index)}方地图`}>
            <div className="map-comparison-toolbar">
              <span>{side(index)}</span>
              <ComparisonSourceSelector side={side(index)} pane={index} choices={session.choices} selectedId={choice(index).id} onSelect={id => select(index, id)} onTriggerRef={element => { sourceControls.current[index] = element; }} />
              <button className="map-comparison-step" aria-label={`${side(index)}图：上一图源`} title="上一图源" disabled={!canStepSource} onClick={() => step(index, -1)}><ChevronUp size={20}/></button>
              <button className="map-comparison-step" aria-label={`${side(index)}图：下一图源`} title="下一图源" disabled={!canStepSource} onClick={() => step(index, 1)}><ChevronDown size={20}/></button>
              <button className="map-comparison-use" aria-label={`使用${side(index)}方图源`} onClick={() => finish(() => onUse(choice(index)))}>选用</button>
            </div>
            {((mode === 'draw' && operations?.drawingEnabled !== false) ||
              (!!operations?.editingTrack && children.props.drawingActive === true)) &&
              drawingOverlay?.(index, index === 0 ? primary : secondary)}
            <span className="map-comparison-cross" aria-label={`${side(index)}图中心十字`} role="img" />
            {status[index] && /失败|未能|暂未|拒绝|中断/.test(status[index]) && <p className="map-comparison-status" role="status">{status[index]}</p>}
            {operations?.editingTrack && editorPaneOverlay?.(index, index === 0 ? primary : secondary)}
          </section>)}
        </div>
        {plannedRoute && !operations?.editingTrack && mode === 'browse' && layerPane === null && properties === null && <section className="map-comparison-planned-route" aria-label="已选规划路线">
          <header><strong>路线规划</strong><RouteNameInput name={plannedRoute.name} onSave={plannedRoute.onRename}/><button type="button" className="comparison-route-hide" aria-label={plannedRoute.visible ? '隐藏规划路线' : '显示规划路线'} onClick={plannedRoute.onToggleVisible}>{plannedRoute.visible ? '隐藏' : '显示'}</button><button type="button" aria-label="关闭规划路线操作" onClick={plannedRoute.onClose}><X size={18}/></button></header>
          <p><strong>{formatDistance(plannedRoute.distance)}</strong><span>{formatDuration(plannedRoute.duration)}</span></p>
          <nav aria-label="双图规划路线操作">
            <button type="button" onClick={plannedRoute.onShow}>看全程</button>
            <button type="button" className="route-solid" onClick={plannedRoute.onEdit}>编辑线点</button>
            <button type="button" onClick={plannedRoute.onDetails}>更多操作</button>
          </nav>
        </section>}
        {!plannedRoute && operations?.selectedTrack && mode === 'browse' && layerPane === null && properties === null && <section className="map-comparison-track-selection" aria-label="已选路线">
          <strong title={operations.selectedTrack.name}>{operations.selectedTrack.name}</strong>
          <button type="button" onClick={operations.onEditSelectedTrack}>编辑</button>
          <button type="button" aria-label="删除双图已选路线" onClick={() => setConfirmDeleteTrackId(operations.selectedTrack!.id)}><Trash2 size={16}/>删除</button>
          {confirmDeleteTrackId === operations.selectedTrack.id && <div className="map-comparison-track-delete-confirm" role="group" aria-label="确认删除双图已选路线">
            <span>删除这条路线？关联照片、标记及来源路线保留。</span>
            <button type="button" onClick={() => setConfirmDeleteTrackId(null)}>取消</button>
            <button type="button" className="route-danger" onClick={() => { if (operations.onDeleteSelectedTrack?.()) setConfirmDeleteTrackId(null); }}>确认删除</button>
          </div>}
        </section>}
        {editorOverlay && <section className="map-comparison-edit-window" data-kind="route" data-pane={editorPane} aria-label="双图路线编辑窗口">
          <ComparisonEditorPosition.Provider value={editorPosition}>
            <div className="map-comparison-editor-content">{editorOverlay}</div>
          </ComparisonEditorPosition.Provider>
        </section>}
        {editorDialog}
        {layerPane !== null && <ComparisonLayerWindow pane={layerPane} onPane={setLayerPane} choice={choice(layerPane)} side={side}
          onChange={patch => changeLayers(layerPane, patch)} onClose={closeLayers} status={status[layerPane]}
          satelliteDate={satellite[layerPane]?.date} satelliteStatus={satellite[layerPane]?.status}
          onSource={() => { const index = layerPane; setLayerPane(null); sourceControls.current[index]?.focus({ preventScroll: true }); }} />}
        {mode === 'draw' && operations?.drawingEnabled !== false && <div className="map-comparison-drawing-mode" aria-label="画线吸附设置">
          <button type="button" title="节点吸附" aria-label="节点吸附" aria-pressed={operations?.snapping ?? false} disabled={!operations} onClick={() => operations?.onSnappingChange(!operations.snapping)}>点吸附</button>
          <button type="button" title="道路吸附" aria-label="道路吸附" aria-pressed={operations?.roadSnapping ?? false} disabled={!operations} onClick={() => operations?.onRoadSnappingChange(!operations.roadSnapping)}>道路</button>
          <button type="button" title="河流吸附" aria-label="河流吸附" aria-pressed={operations?.riverSnapping ?? false} disabled={!operations} onClick={() => operations?.onRiverSnappingChange(!operations.riverSnapping)}>河流</button>
        </div>}
        <div className="map-comparison-gizmo">
          <CameraGizmo view={view ?? camera.current ?? session.camera} onView={(pitch, bearing) => {
            enableTerrain(pitch);
            primary.current?.view(pitch, bearing, false);
          }} onGestureView={(pitch, bearing, phase) => {
            if (phase !== 'cancel') enableTerrain(pitch);
            primary.current?.viewGesture(pitch, bearing, phase);
          }} />
        </div>
        <div className="map-comparison-actions" aria-label="对比地图操作">
          <button aria-label="放大对比地图" title="放大" onClick={() => primary.current?.zoom(1)}><Plus size={23}/></button>
          <button aria-label="缩小对比地图" title="缩小" onClick={() => primary.current?.zoom(-1)}><Minus size={23}/></button>
          <button className="dimension-button" aria-label="切换对比地图二维三维" aria-pressed={(view?.pitch ?? camera.current?.pitch ?? 0) > 0} onClick={() => {
            const current = primary.current?.cameraSnapshot();
            if (current) { const pitch = current.pitch > 0 ? 0 : 50; enableTerrain(pitch); primary.current?.view(pitch, current.bearing, false); }
          }}>{(view?.pitch ?? camera.current?.pitch ?? 0) > 0 ? '3D' : '2D'}</button>
          {mode === 'browse' ? <button aria-label="添加地点标记" title="添加标记" onClick={() => { setLayerPane(null); markCenter('pin'); }} disabled={!operations}><MapPinPlus size={18}/><small>标记</small></button> : <span className="map-comparison-direction"><DirectionControl mode={operations?.direction ?? 'free'} status={operations?.directionStatus} onChange={mode => operations?.onDirectionChange(mode)} />{operations?.directionStatus && <small className="map-comparison-direction-status" role="status" aria-live="polite">{operations.directionStatus}</small>}</span>}
          {mode === 'draw' ? <>
            <button onClick={operations?.onUndo} disabled={!operations?.canUndo}><Undo2 size={18}/><small>撤销</small></button>
            <button onClick={() => { if (operations?.onSave()) { setMode('browse'); setNotice('路线已保存'); } }}><Check size={18}/><small>保存</small></button>
            <button onClick={pause}><Pause size={18}/><small>暂停</small></button>
          </> : <>
            <button aria-label={followError || followLocating || (operations?.following && !followTracking) ? '重试定位' : followTracking ? '关闭位置跟随' : '开启位置跟随'} title={operations?.followBlocked ? '当前编辑操作中，跟随已暂停' : followError ? `重试定位：${followError}` : (followLocating ? '正在等待有效定位' : '单击切换跟随，双击定位')} aria-pressed={followTracking} onClick={event => {
              const now = Date.now();
              if (operations?.onLocate && (event.detail >= 2 || now - lastFollowClick.current < 350)) {
                if (followTimer.current !== null) window.clearTimeout(followTimer.current);
                followTimer.current = null;
                lastFollowClick.current = 0;
                operations.onLocate();
                return;
              }
              if (followTimer.current !== null) window.clearTimeout(followTimer.current);
              lastFollowClick.current = now;
              followTimer.current = window.setTimeout(() => {
                followTimer.current = null;
                lastFollowClick.current = 0;
                operations?.onToggleFollowing();
              }, operations?.onLocate ? 280 : 0);
            }} disabled={!operations}><LocateFixed size={18}/><small>{followError ? '重试' : followLocating ? '定位中' : followTracking ? '跟随中' : '跟随'}</small></button>
            <span className="map-comparison-direction"><DirectionControl mode={operations?.direction ?? 'free'} status={operations?.directionStatus} onChange={mode => operations?.onDirectionChange(mode)} />{operations?.directionStatus && <small className="map-comparison-direction-status" role="status" aria-live="polite">{operations.directionStatus}</small>}</span>
            <button onClick={() => { operations?.onDraw(); setMode('draw'); setNotice(''); setProperties(null); setLayerPane(null); }} disabled={!operations}><PencilIcon width={20} height={20}/><small>画线</small></button>
          </>}
          {operations?.error && mode !== 'browse' && <p className="map-comparison-operation-error" role="alert">{operations.error}</p>}
        </div>
        {properties === 'line' && operations?.style && operations.onStyle && <ComparisonLineProperties style={operations.style} onChange={operations.onStyle} onClose={() => setProperties(null)} />}
        {markerWorkspace && <section className="map-comparison-edit-window map-comparison-editor-slot" data-kind="marker" data-pane={editorPane} aria-label="双图标记编辑窗口">
          <ComparisonEditorPosition.Provider value={editorPosition}>
            <div className="map-comparison-editor-content">{markerWorkspace}</div>
          </ComparisonEditorPosition.Provider>
        </section>}
      </section>
    </>}
  </>;
}
