import { cloneElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';
import type { MapHandle, TerrainMapProps } from '../map/TerrainMap';
import type { CameraSnapshot } from '../controls/useMapFocusLock';
import type { ComparisonChoice } from './choices';
import type { Coordinate } from '../navigation/types';
import type { ViewState } from '../map/types';
import { CameraGizmo } from '../controls/CameraGizmo';
import { FullscreenButton } from '../controls/FullscreenButton';
import type { Annotation } from '../annotations/data';
import type { TrackStyle } from '../tracks/style';
import type { DrawingInput } from '../tracks/DrawingGestureBridge';
import { ComparisonLineProperties, ComparisonMarkerEditor } from './ComparisonProperties';
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
  operations?: {
    onMark: (point: Coordinate) => boolean;
    onDraw: () => void;
    onUndo: () => void;
    onSave: () => boolean;
    onPause: () => void;
    onLocate: () => void;
    canUndo: boolean;
    drawingEnabled?: boolean;
    snapping: boolean;
    onSnappingChange: (enabled: boolean) => void;
    roadSnapping: boolean;
    onRoadSnappingChange: (enabled: boolean) => void;
    riverSnapping: boolean;
    onRiverSnappingChange: (enabled: boolean) => void;
    error: string;
    markerError?: string;
    style?: TrackStyle;
    onStyle?: (style: TrackStyle) => void;
    marker?: Annotation;
    onSelectMarker?: (id: string) => boolean;
    onUpdateMarker?: (id: string, patch: Pick<Annotation, 'name' | 'note' | 'color' | 'icon'>) => boolean;
  };
  children: ReactElement<TerrainMapProps>;
};
const noop = () => {};

/** The primary map remains mounted in its original DOM position during comparison. */
export function MapComparisonHost({ session, primary, onClose, onUse, children, operations, view, search, onDrawingInput, drawingOverlay }: Props) {
  const secondary = useRef<MapHandle | null>(null);
  const camera = useRef<CameraSnapshot | null>(null);
  const previous = useRef<ComparisonSession | null>(null);
  const [selected, setSelected] = useState<[string, string]>(['current', 'sentinel']);
  const [status, setStatus] = useState<[string, string]>(['', '']);
  const [mode, setMode] = useState<'browse' | 'draw'>('browse');
  const [properties, setProperties] = useState<'line' | 'marker' | null>(null);
  const [notice, setNotice] = useState('');
  const [forceTerrain, setForceTerrain] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const close = useRef<HTMLButtonElement>(null);
  // A new session uses the currently displayed camera/source, including wrapped worlds.
  if (previous.current !== session) {
    previous.current = session;
    camera.current = session?.camera ?? null;
  }
  useEffect(() => {
    if (!session) return;
    setSelected(['current', session.choices[0].settings.satellite && !session.choices[0].source ? 'terrain' : 'sentinel']);
    setStatus(['', '']);
    setMode('browse');
    setProperties(null);
    setNotice('');
    setForceTerrain(false);
    close.current?.focus({ preventScroll: true });
  }, [session]);
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
    camera.current = next;
    (from === 0 ? secondary : primary).current?.applyCamera(next);
  };
  const choices = useMemo(() => session?.choices.map(item => forceTerrain && !item.settings.terrain
    ? { ...item, settings: { ...item.settings, terrain: true } } : item) ?? [], [session, forceTerrain]);
  const choice = (index: 0 | 1) => choices.find(item => item.id === selected[index]) ?? choices[0];
  const enableTerrain = (pitch: number) => {
    if (pitch <= 0) return;
    setForceTerrain(true);
    primary.current?.setTerrainMode(true);
    secondary.current?.setTerrainMode(true);
  };
  const report = (index: 0 | 1, message: string) => setStatus(old => old[index] === message ? old : index === 0 ? [message, old[1]] : [old[0], message]);
  const select = (index: 0 | 1, id: string) => {
    setSelected(old => index === 0 ? [id, old[1]] : [old[0], id]);
    report(index, '正在加载地图…');
  };
  const step = (index: 0 | 1, direction: -1 | 1) => {
    const items = session!.choices;
    const current = items.findIndex(item => item.id === choice(index).id);
    select(index, items[(current + direction + items.length) % items.length].id);
  };
  const pause = () => { if (mode === 'draw') operations?.onPause(); setMode('browse'); setNotice(''); };
  const finish = (action: () => void) => { pause(); setProperties(null); action(); };
  const markCenter = () => {
    const center = primary.current?.centerCoordinate() ?? camera.current?.center;
    if (center && operations?.onMark(center)) { setNotice('标记已添加，可编辑'); setProperties('marker'); }
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
    drawingActive: mode === 'draw' && operations?.drawingEnabled !== false,
    pickingActive: mode !== 'draw',
    sectionEditing: false,
    annotationPicking: mode === 'browse',
    measurementPicking: false,
    onMapPick: noop,
    onDrawingInput: event => onDrawingInput?.(index, event),
    onMapHold: noop,
    onAnnotationSelect: selectMarker,
    onAnnotationNavigate: noop,
    onPhotoSelect: noop,
    collectionPreviewActive: false,
    onCameraChange: value => synchronize(index, value),
    onReady: () => { if (camera.current) (index === 0 ? primary : secondary).current?.applyCamera(camera.current); },
    onSourceStatus: message => report(index, message),
    onStatus: message => report(index, message),
  });
  return <>
    {cloneElement(children, session ? mapProps(0) : {})}
    {session && <>
      {cloneElement(children, {
        ...mapProps(1),
        // React's special ref is not part of the map's business props.
        ref: secondary,
        persistCamera: false,
        initialCamera: session.camera,
        onView: noop, onCenter: noop, onPoint: noop, onAnchor: noop,
        onSatellite: noop, onGeology: noop, onSectionStatus: noop,
        onSectionChange: noop, onSectionProfile: noop, onModelTerrainStatus: noop,
      } as Partial<TerrainMapProps> & { ref: RefObject<MapHandle | null> })}
      <section className="map-comparison-ui" aria-label="双图源对比" data-app-back="30" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (properties) setProperties(null); else if (mode !== 'browse') pause(); else finish(onClose); }
      }}>
        <header className="map-comparison-heading">
          <strong>对比</strong>{search}
          <span className="map-comparison-live" role="status" aria-live="polite">{mode === 'draw' ? '标准轨迹绘制已开启' : notice || '十字定位 · 双向同步'}</span>
          <FullscreenButton compact />
          <button ref={close} onClick={() => finish(onClose)} aria-label="退出双图源对比">退出</button>
        </header>
        <div className="map-comparison-panes">
          {([0, 1] as const).map(index => <section key={index} className="map-comparison-pane" aria-label={`${side(index)}方地图`}>
            <div className="map-comparison-toolbar">
              <span>{side(index)}</span>
              <select aria-label={`${side(index)}方图源`} value={choice(index).id} onChange={event => select(index, event.target.value)}>
                {(['当前', '内置', '我的图源', '公共库'] as const).map(group => <optgroup key={group} label={group}>
                  {session.choices.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </optgroup>)}
              </select>
              <button className="map-comparison-step" aria-label={`${side(index)}图：上一图源`} title="上一图源" onClick={() => step(index, -1)}>↑</button>
              <button className="map-comparison-step" aria-label={`${side(index)}图：下一图源`} title="下一图源" onClick={() => step(index, 1)}>↓</button>
              <button className="map-comparison-use" aria-label={`使用${side(index)}方图源`} onClick={() => finish(() => onUse(choice(index)))}>选用</button>
            </div>
            {mode === 'draw' && operations?.drawingEnabled !== false && drawingOverlay?.(index, index === 0 ? primary : secondary)}
            <span className="map-comparison-cross" aria-label={`${side(index)}图中心十字`} role="img" />
            {status[index] && /失败|未能|暂未|拒绝|中断/.test(status[index]) && <p className="map-comparison-status" role="status">{status[index]}</p>}
          </section>)}
        </div>
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
          <button aria-label="放大对比地图" onClick={() => primary.current?.zoom(1)}>＋</button>
          <button aria-label="缩小对比地图" onClick={() => primary.current?.zoom(-1)}>−</button>
          <button aria-label="切换对比地图二维三维" onClick={() => {
            const current = primary.current?.cameraSnapshot();
            if (current) { const pitch = current.pitch > 0 ? 0 : 50; enableTerrain(pitch); primary.current?.view(pitch, current.bearing, false); }
          }}>3D</button>
          <button aria-label="对比地图朝北" onClick={() => primary.current?.north()} className="map-comparison-north">北</button>
          {mode === 'draw' ? <>
            <button onClick={operations?.onUndo} disabled={!operations?.canUndo}>撤销</button>
            <button onClick={() => { if (operations?.onSave()) { setMode('browse'); setNotice('路线已保存'); } }}>保存</button>
            <button onClick={pause}>暂停</button>
            <button aria-label="画线属性" className="map-comparison-properties-button" onClick={() => setProperties(properties === 'line' ? null : 'line')}>属性</button>
          </> : <>
            <button onClick={operations?.onLocate} disabled={!operations}>定位</button>
            <button onClick={markCenter} disabled={!operations}>标记</button>
            <button onClick={() => { operations?.onDraw(); setMode('draw'); setNotice(''); setProperties(null); }} disabled={!operations}>画线</button>
            <button aria-label="画线属性" className="map-comparison-properties-button" onClick={() => setProperties(properties === 'line' ? null : 'line')}>属性</button>
          </>}
          {operations?.error && mode !== 'browse' && <p className="map-comparison-operation-error" role="alert">{operations.error}</p>}
        </div>
        {properties === 'line' && operations?.style && operations.onStyle && <ComparisonLineProperties style={operations.style} onChange={operations.onStyle} onClose={() => setProperties(null)} />}
        {properties === 'marker' && operations?.marker && operations.onUpdateMarker && <ComparisonMarkerEditor key={operations.marker.id} annotation={operations.marker} onSave={operations.onUpdateMarker} error={operations.markerError} onClose={() => setProperties(null)} />}
      </section>
    </>}
  </>;
}
