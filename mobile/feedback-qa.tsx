import { createRoot } from 'react-dom/client';
import { useMemo, useState, type CSSProperties } from 'react';
import { DEFAULT_APPEARANCE, themeTokens, type Palette } from '../modules/appearance/theme';
import { GuidanceCard } from '../modules/guidance/GuidanceCard';
import { GuidanceProgressRail } from '../modules/guidance/GuidanceProgressRail';
import { NavigationTelemetry } from '../modules/guidance/NavigationTelemetry';
import { createSession } from '../modules/guidance/session';
import type { GuidanceState } from '../modules/guidance/useGuidance';
import { PinEditor } from '../modules/annotations/PinEditor';
import { useAnnotations } from '../modules/annotations/useAnnotations';
import { ANNOTATION_STORAGE, newAnnotation } from '../modules/annotations/data';
import { RouteEditToolbar } from '../modules/tracks/RouteViews';
import { AppColorPicker } from '../modules/appearance/AppColorPicker';
import { TrackDrawingStyle } from '../modules/tracks/TrackDrawingStyle';
import { OfflineModePrompt } from '../modules/outdoor/OfflineModePrompt';
import { TrackNodeBoxSelect } from '../modules/tracks/TrackNodeBoxSelect';
import { startRouteEdit, selectEditNode, renameEditRoute, insertEditNode, removeEditNodes, editSelectionDetails, setEditEnd, toggleEditBranch, undoRouteEdit, styleRouteEdit, addEditMarker } from '../modules/tracks/routeEdit';
import type { ManualTrack, ScreenPoint } from '../modules/tracks/drawing';
import type { PointDetail } from '../modules/tracks/selectionDetails';
import type { PointMarkerInput } from '../modules/tracks/RoutePointMarkerFields';
import type { TrackStyle } from '../modules/tracks/style';
import type { BoxSelectionMode } from '../modules/collections/boxSelection';
import { RouteCachePanel } from '../modules/outdoor/RouteCachePanel';
import { WorkbenchPanel } from '../modules/collections/WorkbenchPanel';
import { ControlDock } from '../modules/controls/ControlDock';
import { OfflineMapProgressPrompt } from '../modules/outdoor/OfflineMapProgressPrompt';
import type { TripPackage } from '../modules/outdoor/offline';
import type { useOffline } from '../modules/outdoor/useOffline';
import type { MapSource } from '../modules/mapSources/types';
import type { Coordinate, PlannedRoute } from '../modules/navigation/types';
import { lineLength } from '../modules/journey/metrics';
import { DEFAULT_TRACK_STYLE } from '../modules/tracks/style';
import '../modules/appearance/appearance.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../modules/photos/photos.css';
import '../app/globals.css';
import '../modules/controls/workspace.css';
import '../modules/controls/panels.css';
import '../modules/collections/workbenchCache.css';
import '../modules/geology/legend.css';
import '../modules/navigation/navigation.css';
import '../modules/tracks/tracks.css';
import '../modules/journey/journey.css';
import '../modules/journey/route-rail.css';
import '../modules/position/position.css';
import '../modules/annotations/annotations.css';
import '../modules/section/section.css';
import '../modules/objectTransform/objectTransform.css';
import '../modules/controls/modern.css';
import './compatibility.css';
import '../modules/controls/compactDensity.css';
import '../modules/controls/homeMap.css';
import '../modules/controls/outdoorSurfaces.css';
import '../modules/controls/outdoorTheme.css';
import '../modules/rally/rally.css';
import '../modules/routeDisplay/routeDisplay.css';
import '../modules/guidance/guidance.css';
import '../modules/guidance/guidanceProgress.css';
import '../modules/guidance/telemetry.css';
import '../modules/annotations/pinEditor.css';
import '../modules/tracks/routeWindows.css';
import '../modules/collections/boxSelection.css';
import '../modules/outdoor/routeCachePanel.css';
import '../modules/outdoor/offlineMapProgressPrompt.css';

const QA_PREFIX = '__feedback_qa__:';
const storagePrototype = Storage.prototype;
const nativeGet = storagePrototype.getItem;
const nativeSet = storagePrototype.setItem;
const nativeRemove = storagePrototype.removeItem;
// Namespace every localStorage access so mounted production components cannot
// read or change the user's app keys from this QA page.
const isolatedKey = (key: string) => `${QA_PREFIX}${key}`;
storagePrototype.getItem = function (key) { return nativeGet.call(this, isolatedKey(String(key))); };
storagePrototype.setItem = function (key, value) { return nativeSet.call(this, isolatedKey(String(key)), String(value)); };
storagePrototype.removeItem = function (key) { return nativeRemove.call(this, isolatedKey(String(key))); };
window.addEventListener('beforeunload', () => {
  storagePrototype.getItem = nativeGet;
  storagePrototype.setItem = nativeSet;
  storagePrototype.removeItem = nativeRemove;
}, { once: true });
const isolatedAnnotationsKey = `${QA_PREFIX}${ANNOTATION_STORAGE}`;
if (nativeGet.call(localStorage, isolatedAnnotationsKey) === null) {
  const seed = {
    ...newAnnotation('pin', [104.05621, 30.65432], 326, 'feedback-qa-pin'),
    name: '合成标记 · 河边入口',
    note: '仅供界面布局检查，不对应真实位置记录。',
    attributes: [{ name: '验收状态', value: '合成数据' }, { name: '来源', value: 'feedback-qa 专用存储' }],
  };
  nativeSet.call(localStorage, isolatedAnnotationsKey, JSON.stringify([seed]));
}

const query = new URLSearchParams(location.search);
if (query.get('only') === '1') localStorage.setItem('shantu.offline-map-only.v1', 'true');
else localStorage.setItem('shantu.offline-map-only.v1', 'false');
if (query.get('legacy') === '1') Object.defineProperty(window, 'GuanyunNative', { configurable: true,
  value: { offlineStart() { throw new Error('QA 不执行原生下载'); }, offlineExportLegacyArchive() { throw new Error('QA 仅显示备份入口，不执行导出'); } } });
const initialWidth = Number(query.get('width'));
const initialHeight = Number(query.get('height'));
const initialPanel = query.get('panel');
const initialTheme = query.get('theme');
const orangePalette: Palette = { ...DEFAULT_APPEARANCE.dark, accent: '#ffad55', button: '#302b25' };
const routeCoordinates: Coordinate[] = Array.from({ length: 25 }, (_, i) => [
  104.05 + i * 0.00045,
  30.65 + Math.sin(i / 3) * 0.00025,
]);
const plannedRoute: PlannedRoute = {
  mode: 'bicycle', coordinates: routeCoordinates, distance: lineLength(routeCoordinates), duration: 1900,
  steps: [{ instruction: '沿绿道继续前行', distance: 620, duration: 240, elapsedSeconds: 240, coordinates: routeCoordinates }],
  snapped: [routeCoordinates[0], routeCoordinates.at(-1)!], createdAt: 1760000000000,
};
const routeTrack: ManualTrack = {
  id: 'feedback-qa-route', name: '合成路线 · 绿道样段', segments: [routeCoordinates],
  createdAt: 1760000000000, updatedAt: 1760000000000, source: 'manual',
  style: { ...DEFAULT_TRACK_STYLE, color: '#4fbb87', pointSize: 9 },
};
const cacheSource: MapSource = {
  id: 'feedback-qa-example', name: 'QA 示例图源（不会请求）', kind: 'online', format: 'XYZ',
  attribution: '合成图源 · 不请求任何地图服务', minzoom: 14, maxzoom: 14, tileSize: 256,
  tiles: ['https://example.test/{z}/{x}/{y}.png'], scheme: 'xyz', bytes: 0, datum: 'wgs84',
};
const sampleTrip: TripPackage = {
  id: 'feedback-qa-progress', name: '合成路线缓存 · 布局检查', provider: 'imported', sourceId: cacheSource.id,
  sourceName: cacheSource.name, bounds: [104.04, 30.64, 104.07, 30.66],
  urls: Array.from({ length: 24 }, (_, i) => `https://example.test/14/${i}/0.png`), done: 7,
  bytes: 374000, createdAt: 1760000000000, complete: false, phase: 'running', phaseMessage: '合成数据·布局检查',
};

const sampleArea = { id:'feedback-area', name:'合成河谷区域', boundary:[[104.05,30.65],[104.054,30.65],[104.054,30.651],[104.051,30.651],[104.051,30.654],[104.05,30.654]] as Coordinate[] };
if (query.get('collectionItem') === '1') localStorage.setItem('guanyun.manual-tracks.v1', JSON.stringify([routeTrack]));

function Fixture() {
  const [panel, setPanel] = useState<'navigation' | 'pin' | 'route' | 'cache' | 'progress' | 'collections' | 'draw'>(
    initialPanel === 'pin' || initialPanel === 'route' || initialPanel === 'cache' || initialPanel === 'progress' || initialPanel === 'collections' || initialPanel === 'draw' ? initialPanel : 'navigation',
  );
  const [width, setWidth] = useState(initialWidth === 360 ? 360 : 390);
  const [height, setHeight] = useState([480, 780, 857].includes(initialHeight) ? initialHeight : 857);
  const [themeName, setThemeName] = useState(initialTheme === 'light' || initialTheme === 'orange' ? initialTheme : 'dark');
  const [pane, setPane] = useState(query.get('pane') === '2' ? 2 : 1);
  const [stateVariant, setStateVariant] = useState({ error: query.get('error') === '1', departure: query.get('deparature') === '1', forward: query.get('forward') === '1' });
  const [tripOpened, setTripOpened] = useState(false);
  const [focusCacheId, setFocusCacheId] = useState<string>();
  const [progressPhase, setProgressPhase] = useState<'running' | 'waiting' | 'failed'>(query.get('phase') === 'failed' ? 'failed' : query.get('phase') === 'waiting' ? 'waiting' : 'running');
  const [offlineMessage, setOfflineMessage] = useState('');
  const [drawingStyle, setDrawingStyle] = useState(DEFAULT_TRACK_STYLE);
  const [drawingNote, setDrawingNote] = useState('');
  const annotations = useAnnotations();
  const pin = annotations.items.find(item => item.id === 'feedback-qa-pin') ?? annotations.items[0];
  const [editSession, setEditSession] = useState(() => selectEditNode(startRouteEdit(routeTrack), routeCoordinates[7]));
  const [selectedPoints, setSelectedPoints] = useState<Coordinate[]>([routeCoordinates[7]]);
  const [boxMode, setBoxMode] = useState<BoxSelectionMode | null>('add');
  const [snap, setSnap] = useState({ node: true, road: false, river: false });
  const [routeNotice, setRouteNotice] = useState('合成数据·布局检查；按钮回调使用真实 routeEdit 操作。');
  const tokenTheme = themeName === 'light' ? DEFAULT_APPEARANCE.light : themeName === 'orange' ? orangePalette : DEFAULT_APPEARANCE.dark;
  const tokens = themeTokens(tokenTheme);
  const guidanceSession = useMemo(() => {
    const session = createSession(plannedRoute, Date.now());
    return {
      ...session,
      progress: session.path.length * 0.38,
      travelled: session.path.length * 0.38,
      departurePending: stateVariant.departure,
      departureLength: stateVariant.departure ? 1250 : 0,
      departureReference: stateVariant.departure,
      quality: '',
      last: null,
    };
  }, [stateVariant.departure]);
  const guidance = {
    active: true, session: guidanceSession, rejoin: null, loading: false,
    error: stateVariant.error ? '附近道路无法接到当前位置或原路线，请移动到道路后重试。合成错误状态，用于检查换行。' : '', online: true,
    remaining: plannedRoute.distance - guidanceSession.progress,
    instruction: { text: '沿绿道继续前行', distance: 620 },
    departureMessage: stateVariant.departure ? '正在前往合成路线起点' : '',
    start: () => true, stop: () => undefined, retry: () => undefined,
    replan: async () => undefined, replanning: false,
    returnToOriginal: () => undefined, returnToOriginalSupported: true,
  } as unknown as GuidanceState;
  const cachePackages: TripPackage[] = query.get('packages') === '2' ? [{ ...sampleTrip,
    id: 'qa182-running', name: '合成山地徒步路线 · 示例影像', sourceId: cacheSource.id, sourceName: cacheSource.name,
    routeNames: ['合成山地徒步路线'], phase: 'running', phaseMessage: '正在缓存', done: 1278, bytes: 32 * 1048576,
    urls: Array.from({ length: 2000 }, (_, i) => `https://example.test/14/${i}/0.png`),
  }, { ...sampleTrip, id: 'qa182-legacy-partial', name: '合成河谷路线 · 原图源已移除', sourceId: 'qa182-missing',
    sourceName: '已移除的示例图源', routeNames: ['合成河谷路线'], phase: undefined, phaseMessage: undefined, done: 12, bytes: 2 * 1048576,
    urls: Array.from({ length: 24 }, (_, i) => `https://example.test/15/${i}/0.png`),
  }] : [];
  const isolatedOffline = {
    packages: cachePackages, removing: [], current: cachePackages[0] ?? null, background: false, busy: cachePackages.length > 0, message: '',
    createMap: async () => undefined,
    createImportedRoute: async (_name: string, area: {kind:string}) => { setOfflineMessage(`QA 已拦截${area.kind}下载；没有发出地图网络请求。`); },
    createRegion: async () => undefined, create: async () => undefined,
    resume: async () => undefined, verify: async () => undefined, remove: async () => undefined,
    pause: () => undefined,
  } as unknown as ReturnType<typeof useOffline>;
  const selectedTrackPoints = editSession.track.segments.flat();
  const project = (coordinate: Coordinate): ScreenPoint | null => {
    const index = selectedTrackPoints.findIndex(point => point[0] === coordinate[0] && point[1] === coordinate[1]);
    if (index < 0) return null;
    return { x: 28 + index * 11 + (pane === 2 ? 18 : 0), y: (height < 600 ? 50 : 172) + Math.sin(index / 3) * 24 + (pane === 2 ? 7 : 0) };
  };
  const setCase = (nextPanel: typeof panel) => {
    setPanel(nextPanel);
    const next = new URLSearchParams(location.search);
    next.set('panel', nextPanel);
    history.replaceState(null, '', `${location.pathname}?${next.toString()}`);
  };
  const updateDimension = (key: 'width' | 'height' | 'pane', value: number) => {
    if (key === 'width') setWidth(value as 360 | 390);
    else if (key === 'height') setHeight(value as 480 | 780 | 857);
    else setPane(value as 1 | 2);
    const next = new URLSearchParams(location.search);
    next.set(key, String(value));
    history.replaceState(null, '', `${location.pathname}?${next.toString()}`);
  };
  const updateState = (key: 'error' | 'deparature' | 'forward', enabled: boolean) => {
    setStateVariant(value => ({ ...value, [key === 'deparature' ? 'departure' : key]: enabled }));
    const next = new URLSearchParams(location.search);
    next.set(key, enabled ? '1' : '0');
    history.replaceState(null, '', `${location.pathname}?${next.toString()}`);
  };
  const routeChange = (update: (value: typeof editSession) => typeof editSession) => {
    setEditSession(current => update(current));
  };
  const selectedNode = selectedPoints[0] ?? editSession.selected ?? routeCoordinates[7];
  const statusTrip: TripPackage = {
    ...sampleTrip, phase: progressPhase,
    phaseMessage: progressPhase === 'failed' ? '合成失败原因：示例服务不可用' : progressPhase === 'waiting' ? '合成状态：等待网络恢复' : '合成数据·布局检查',
  };

  document.documentElement.dataset.uiTheme = themeName === 'light' ? 'light' : 'dark';
  Object.entries(tokens).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));

  return <>
    <nav className="feedback-qa-controls" aria-label="验收用例切换">
      <label>页面<select value={panel} onChange={event => setCase(event.target.value as typeof panel)}>
        <option value="navigation">导航</option><option value="pin">标记</option><option value="route">路线</option><option value="cache">缓存</option><option value="collections">收藏缓存</option><option value="progress">缓存进度</option>
      </select></label>
      <label>宽<select value={width} onChange={event => updateDimension('width', Number(event.target.value))}><option value={360}>360</option><option value={390}>390</option></select></label>
      <label>高<select value={height} onChange={event => updateDimension('height', Number(event.target.value))}><option value={480}>480</option><option value={780}>780</option><option value={857}>857</option></select></label>
      <label>主题<select value={themeName} onChange={event => setThemeName(event.target.value as typeof themeName)}><option value="dark">深色</option><option value="light">浅色</option><option value="orange">暖色</option></select></label>
      {panel === 'route' && <label>投影<select value={pane} onChange={event => updateDimension('pane', Number(event.target.value))}><option value={1}>pane=1</option><option value={2}>pane=2</option></select></label>}
      {panel === 'progress' && <label>任务<select value={progressPhase} onChange={event => {
        const value = event.target.value as typeof progressPhase;
        setProgressPhase(value);
        const next = new URLSearchParams(location.search); next.set('phase', value);
        history.replaceState(null, '', `${location.pathname}?${next.toString()}`);
      }}><option value="running">运行中</option><option value="waiting">等待网络</option><option value="failed">失败</option></select></label>}
      {panel === 'navigation' && <span className="feedback-qa-flags">
        <label><input type="checkbox" checked={stateVariant.error} onChange={event => updateState('error', event.target.checked)} />error=1</label>
        <label><input type="checkbox" checked={stateVariant.departure} onChange={event => updateState('deparature', event.target.checked)} />deparature=1</label>
        <label><input type="checkbox" checked={stateVariant.forward} onChange={event => updateState('forward', event.target.checked)} />forward=1</label>
      </span>}
    </nav>
    <main className="feedback-qa-frame" style={{ width, height, ...tokens } as CSSProperties} data-panel={panel}>
      <div className="observatory home-map" data-ui-style="outdoor" data-panel={panel === 'collections' ? 'favorites' : panel === 'cache' ? 'cache' : undefined} data-guiding={panel === 'navigation' ? 'true' : undefined} style={{
        '--home-top': 'env(safe-area-inset-top, 0px)', '--home-left': '8px', '--home-right': '8px',
        '--home-bottom': 'env(safe-area-inset-bottom, 0px)', '--home-footer': 'calc(64px + var(--home-bottom))', '--home-header-height': '60px',
      } as CSSProperties}>
        <div className="feedback-qa-map" aria-hidden="true"><span>合成数据·布局检查</span></div>
        {panel === 'navigation' && <section className="feedback-qa-navigation">
          <GuidanceCard guidance={guidance} onStop={() => undefined} onFollow={() => undefined} onShow={() => undefined}
            following={false} cameraMode={stateVariant.forward ? 'forward' : 'top'} onFirstPerson={() => updateState('forward', !stateVariant.forward)}
            telemetry={<NavigationTelemetry session={guidanceSession} fix={null} />}
            compactTelemetry={<NavigationTelemetry session={guidanceSession} fix={null} compact />} />
          <GuidanceProgressRail session={guidanceSession} />
          <p className="feedback-qa-data-label">合成数据·布局检查</p>
        </section>}
        {panel === 'pin' && <section className="feedback-qa-pin">
          <p className="feedback-qa-data-label">合成数据·布局检查 · 本页专用存储</p>
          {pin ? <PinEditor state={annotations} item={pin} photos={[]} onClose={() => undefined}
            onShare={() => undefined} onAdjust={() => undefined} onCapture={() => undefined}
            onImport={() => undefined} onPhoto={() => undefined} cameraStatus="相机动作已在 QA 页拦截" />
            : <p role="status">正在载入合成标记…</p>}
        </section>}
        {panel === 'draw' && <section className="track-tools" style={{position:'absolute',top:64,left:8,width:276}}><TrackDrawingStyle style={drawingStyle} onChange={setDrawingStyle} condition={drawingNote} onCondition={setDrawingNote}/><p>合成数据 · 实际画线选色组件</p></section>}
        <OfflineModePrompt />
        {panel === 'route' && <section className="feedback-qa-route">
          <div className="feedback-qa-route-map" aria-label={`合成地图投影模拟 pane=${pane}`}>
            <span className="feedback-qa-pane-label">pane={pane} 投影模拟 · 非双图引擎</span>
            <svg className="feedback-qa-route-line" viewBox={`0 0 ${width} ${height - 128}`} preserveAspectRatio="none" aria-hidden="true">
              <polyline points={selectedTrackPoints.map((point, index) => {
                const screen = project(point)!; return `${screen.x},${screen.y}`;
              }).join(' ')} />
              {selectedTrackPoints.map((point, index) => { const screen = project(point)!; return <circle key={`${point.join(',')}-${index}`} cx={screen.x} cy={screen.y} r="4" />; })}
            </svg>
            <TrackNodeBoxSelect active={boxMode !== null} mode={boxMode ?? 'add'} points={selectedTrackPoints} selected={selectedPoints}
              pointSize={editSession.track.style?.pointSize ?? 9} project={project}
              onChange={points => { setSelectedPoints(points); if (points.length === 1) routeChange(value => selectEditNode(value, points[0])); }}
              onExit={() => setBoxMode(null)} />
          </div>
          <RouteEditToolbar session={editSession} snapHint="合成吸附反馈：调整上方按钮查看按下状态" error="" boxMode={boxMode}
            selectedPoints={selectedPoints} snapping={snap.node} roadSnapping={snap.road} riverSnapping={snap.river}
            onBack={() => setRouteNotice('已触发退出回调；合成路线仍保留在本页。')}
            onSave={() => setRouteNotice('保存回调已触发；验收页不会写入路线存档。')}
            onName={name => routeChange(value => renameEditRoute(value, name))}
            onAdd={() => routeChange(value => insertEditNode(value, selectedNode))}
            onRemove={() => routeChange(value => removeEditNodes(value, selectedPoints))}
            onSelectionMode={mode => setBoxMode(mode)}
            onSelectionDetails={(detail: PointDetail) => routeChange(value => editSelectionDetails(value, selectedPoints, detail))}
            onPointMarker={(input: PointMarkerInput) => {
              routeChange(value => addEditMarker(value, selectedNode, input, crypto.randomUUID(), 326));
              setRouteNotice('标记已加入合成 route session；不会写入标记存档。');
              return true;
            }}
            onSetEnd={() => routeChange(value => setEditEnd(value, selectedNode))}
            onClearSelection={() => setSelectedPoints([])} onBranch={() => routeChange(toggleEditBranch)}
            onUndo={() => routeChange(undoRouteEdit)} onStyle={(style: TrackStyle) => routeChange(value => styleRouteEdit(value, style))}
            onSnapping={() => setSnap(value => ({ ...value, node: !value.node }))}
            onRoadSnapping={() => setSnap(value => ({ ...value, road: !value.road }))}
            onRiverSnapping={() => setSnap(value => ({ ...value, river: !value.river }))} />
          <p className="feedback-qa-route-status" role="status">{routeNotice}</p>
        </section>}
        {panel === 'cache' && <ControlDock active="cache" onActive={() => {}} title={`地图缓存 · ${cachePackages.length}个包`} back={{ label: '返回收藏', onClick: () => setPanel('collections') }}>
          <RouteCachePanel routes={[{ id: 'feedback-route', name: '合成路线 · 绿道样段', segments: [routeCoordinates] }]}
            areas={[sampleArea]} initialAreaId={query.get('area') === '1' ? sampleArea.id : undefined}
            sources={[cacheSource]} offline={isolatedOffline} initialTab={query.get('tab') === 'packages' || focusCacheId ? 'packages' : 'setup'} focusTripId={focusCacheId}
            onPreviewMap={trip => { setFocusCacheId(trip.id); setOfflineMessage('QA 高亮任务：'+trip.name); }}
            onOpenMap={(_trip, only) => setOfflineMessage(`QA 浏览模式：${only ? '仅缓存' : '常规浏览'}；不发出网络请求。`)} onSources={() => setOfflineMessage('此页不导入图源。')} />
          {offlineMessage && <p className="feedback-qa-cache-notice" role="status">{offlineMessage}</p>}
        </ControlDock>}
        {panel === 'collections' && <ControlDock active="favorites" onActive={() => {}} title="收藏">
          <WorkbenchPanel center={[104,30]} onClose={() => {}} onLocate={() => {}} onOpen={() => {}} onNavigate={() => {}} onManage={() => {}}
            onCacheRoute={() => {}} onCacheRoutes={() => {}} onCacheFolder={() => setPanel('cache')} cacheCount={cachePackages.length} cachePackages={cachePackages}
            onCachePackage={id => { setFocusCacheId(id); setPanel('cache'); }} />
        </ControlDock>}
        {panel === 'progress' && <section className="feedback-qa-progress">
          <p className="feedback-qa-data-label">合成数据·布局检查 · 可点开任务状态</p>
          <OfflineMapProgressPrompt trip={statusTrip} onOpenTask={() => setTripOpened(value => !value)} />
          {tripOpened && <div className="feedback-qa-task-detail" role="status"><strong>{statusTrip.name}</strong><span>{statusTrip.phaseMessage}</span><span>完成 {statusTrip.done}/{statusTrip.urls.length} 项 · {(statusTrip.bytes / 1048576).toFixed(1)} MB</span></div>}
        </section>}
        {panel !== 'cache' && panel !== 'collections' && <nav className="feedback-qa-bottom" aria-label="合成底部导航"><span>地图</span><span>路线</span><span>记录</span><span>我的</span></nav>}
      </div>
    </main>
    <AppColorPicker />
    <style>{`
      html,body,#root{min-width:0;min-height:100%;margin:0;background:#101716;font-family:system-ui,sans-serif}
      #root{display:flex;flex-direction:column;align-items:center;gap:0;padding:0;box-sizing:border-box;overflow:auto}
      ${query.get('controls') === '0' ? '.feedback-qa-controls{display:none!important}' : ''}
      .feedback-qa-controls{position:relative;z-index:40;display:flex;flex-wrap:wrap;align-items:center;gap:4px;width:min(100%,900px);box-sizing:border-box;padding:3px 5px;border:1px solid #52645b;border-radius:4px;background:#17211f;color:#edf4ec;font-size:10px}
      .feedback-qa-controls label{display:flex;align-items:center;gap:2px;white-space:nowrap}.feedback-qa-controls select{max-width:106px;height:25px;padding:0 3px;border:1px solid #61756a;border-radius:3px;background:#24312d;color:#f4f7f2;font:inherit}
      .feedback-qa-flags{display:flex;gap:4px}.feedback-qa-flags label{gap:1px}.feedback-qa-flags input{margin:0}
      .feedback-qa-frame{position:relative;flex:none;max-width:100vw;overflow:hidden;background:var(--ui-surface);color:var(--ui-ink);box-shadow:0 12px 48px #0008}
      .feedback-qa-frame>.observatory{position:absolute;inset:0;min-height:0;overflow:hidden;background:#33463e;--home-top:0px;--home-left:8px;--home-right:8px;--home-bottom:0px;--home-footer:64px;--home-header-height:60px}
      .feedback-qa-map{position:absolute;inset:0;opacity:.55;background:linear-gradient(24deg,transparent 48%,#d6ddb455 49%,#d6ddb455 50%,transparent 51%),linear-gradient(122deg,transparent 36%,#263d3555 37%,#263d3555 38%,transparent 39%)}
      .feedback-qa-map>span{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);padding:3px 6px;background:#10171699;color:#fff;font-size:10px;white-space:nowrap}
      .feedback-qa-bottom{position:absolute;z-index:8;left:0;right:0;bottom:0;height:64px;display:flex;align-items:center;justify-content:space-around;background:var(--ui-surface);color:var(--ui-muted);font-size:11px}
      .feedback-qa-data-label{margin:0 0 4px;color:var(--ui-muted);font-size:10px;line-height:1.25}
      .feedback-qa-navigation{display:contents}
      .feedback-qa-telemetry{display:flex;gap:7px;flex-wrap:wrap;color:var(--ui-muted);font-size:10px}
      .feedback-qa-pin,.feedback-qa-route{display:contents}
      .feedback-qa-route-map{position:absolute;inset:64px 0 64px;overflow:hidden;background:linear-gradient(150deg,#58715f,#839176 47%,#586c60)}
      .feedback-qa-pane-label{position:absolute;z-index:3;left:6px;top:5px;padding:2px 4px;background:#101716aa;color:white;font-size:9px}
      .feedback-qa-route-line{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.feedback-qa-route-line polyline{fill:none;stroke:#4fbb87;stroke-width:3}.feedback-qa-route-line circle{fill:#194a39;stroke:#b6f0d0;stroke-width:1.5}
      .feedback-qa-route-map .map-box-selection{position:absolute;inset:0}
      .feedback-qa-route-status{position:absolute;bottom:300px;left:8px;right:80px;margin:0;padding:3px 5px;border-radius:3px;background:var(--ui-surface);color:var(--ui-muted);font-size:9px}
      .feedback-qa-cache,.feedback-qa-progress{position:absolute;z-index:6;inset:6px 6px 70px;display:flex;flex-direction:column;min-height:0;gap:5px;overflow:auto}
      .feedback-qa-cache .route-cache-panel{position:relative;inset:auto;left:auto;right:auto;bottom:auto;width:100%;max-width:none;max-height:none;overflow:auto;flex:1;min-height:0}
      .feedback-qa-cache-notice,.feedback-qa-task-detail{margin:0;padding:5px;border:1px solid var(--ui-line);border-radius:4px;background:var(--ui-surface);font-size:10px}
      .feedback-qa-task-detail{display:grid;gap:3px}.feedback-qa-progress{display:contents}.feedback-qa-progress>.feedback-qa-task-detail{position:absolute;top:90px;left:8px;right:80px}
    `}</style>
  </>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
