import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapSource } from '../mapSources/types';
import type { Coordinate } from '../navigation/types';
import { MAX_IMPORTED_DOWNLOAD_BYTES, MAX_IMPORTED_DOWNLOAD_RESOURCES, validateImportedDownloadSource } from './importedRouteDownload';
import { estimateImportedRouteDownloadAsync } from './asyncImportedRoutePlan';
import { OFFLINE_MAP_KEY } from './tileCache';
import { canExportLegacyOfflineArchive, requestLegacyOfflineArchiveExport } from './nativeOffline';
import type { TripPackage } from './offline';
import { cachePackagePreview } from './cachePackagePreview';
import type { useOffline } from './useOffline';
import './routeCachePanel.css';

type RouteCacheRoute = { id: string; name: string; segments: Coordinate[][] };
type RouteCacheArea = { id: string; name: string; boundary: Coordinate[] };
type Props = {
  routes: RouteCacheRoute[];
  areas?: RouteCacheArea[];
  sources: MapSource[];
  offline: ReturnType<typeof useOffline>;
  onOpenMap: (trip: TripPackage, onlyCached?: boolean) => void;
  onPreviewMap?: (trip: TripPackage) => void;
  onSources: () => void;
  initialRouteId?: string;
  initialAreaId?: string;
  initialTab?: 'setup' | 'packages';
  focusTripId?: string;
  batch?: boolean;
  initialRouteIds?: string[];
};

const widths = [0.5, 1, 2, 4];

function cachedRouteName(trip: TripPackage) {
  if (trip.routeNames?.length) return trip.routeNames.join('、');
  const suffix = trip.sourceName ? ` · ${trip.sourceName}` : '';
  return suffix && trip.name.endsWith(suffix) ? trip.name.slice(0, -suffix.length) : trip.name;
}

function cachedSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return bytes > 0 ? `${(bytes / 1024).toFixed(1)} KB` : '0 KB';
}

function estimatedSize(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.ceil(bytes / 1024)} KB`;
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function zoomOptions(source: MapSource) {
  if (!Number.isInteger(source.minzoom) || !Number.isInteger(source.maxzoom) || source.minzoom < 0 || source.maxzoom > 24 || source.maxzoom < source.minzoom) return [];
  return Array.from({ length: source.maxzoom - source.minzoom + 1 }, (_, i) => source.minzoom + i);
}

function initialZoom(source: MapSource) {
  const values = zoomOptions(source);
  return values.includes(14) ? 14 : values.find((value) => value > 14) ?? values[values.length - 1] ?? 0;
}

function isOfflineOnly() {
  try { return localStorage.getItem(OFFLINE_MAP_KEY) === 'true'; } catch { return false; }
}

function isDownloadableArea(area: RouteCacheArea) {
  return area.boundary.length >= 3 && area.boundary.every(([longitude, latitude]) =>
    Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
    Number.isFinite(latitude) && latitude >= -90 && latitude <= 90);
}

function readSelectedPackageId() {
  try { return localStorage.getItem('shantu.offline-package.v1') ?? ''; } catch { return ''; }
}

function packageProgressLabel(trip: TripPackage, downloading: boolean) {
  const count = `${trip.done}/${trip.urls.length} 项 · ${cachedSize(trip.bytes)}`;
  if (trip.phase === 'preparing' || (!trip.urls.length && !trip.complete)) return `${trip.phaseMessage || '正在规划路线缓存'} · ${count}`;
  if (trip.phase === 'failed') return `${trip.phaseMessage || '缓存失败'} · ${count}`;
  if (trip.phase === 'waiting') return `${trip.phaseMessage || '等待网络恢复，已下载内容保留'} · ${count}`;
  if (trip.complete || trip.phase === 'complete') return `已完成 · ${count}`;
  if (trip.phase === 'paused') return `已暂停，可继续 · ${count}`;
  if (downloading || trip.phase === 'running') return `下载中 · ${count}`;
  if (trip.phase === 'queued') return `排队中 · ${count}`;
  return `未完成 · ${count}`;
}

export function RouteCachePanel({ routes, areas = [], sources, offline, onOpenMap, onPreviewMap, onSources, initialRouteId, initialAreaId, initialTab = 'setup', focusTripId, batch = false, initialRouteIds = [] }: Props) {
  const onlineSources = useMemo(() => sources.filter((source) => source.kind === 'online'), [sources]);
  const selectableAreas = useMemo(() => areas.filter(isDownloadableArea), [areas]);
  const [tab, setTab] = useState<'setup' | 'packages'>(initialTab);
  const [setupStep, setSetupStep] = useState<'selectRoutes' | 'route' | 'source' | 'settings'>(() => batch ? 'selectRoutes' : 'route');
  const [cacheMode, setCacheMode] = useState<'route' | 'area'>(() => initialAreaId ? 'area' : 'route');
  const [routeId, setRouteId] = useState(initialRouteId ?? routes[0]?.id ?? '');
  const [areaId, setAreaId] = useState(initialAreaId ?? areas[0]?.id ?? '');
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>(initialRouteIds);
  const [sourceId, setSourceId] = useState('');
  const [bufferKm, setBufferKm] = useState(4);
  const [zoom, setZoom] = useState(14);
  const [onlyCached, setOnlyCached] = useState(isOfflineOnly);
  const [selectedPackageId, setSelectedPackageId] = useState(readSelectedPackageId);
  const [removeConfirmId, setRemoveConfirmId] = useState('');
  const [hiddenCompletedTripId, setHiddenCompletedTripId] = useState(offline.current?.complete ? offline.current.id : '');
  const [openError, setOpenError] = useState('');
  const [attemptedStart, setAttemptedStart] = useState(false);
  const packageListRef = useRef<HTMLDivElement>(null);
  const selectedRoute = routes.find((route) => route.id === routeId) ?? routes[0];
  const selectedArea = selectableAreas.find((area) => area.id === areaId) ?? selectableAreas[0];
  const selectableRoutes = useMemo(() => routes.filter((route) => route.segments.some((segment) => segment.length >= 2)), [routes]);
  const selectedRoutes = useMemo(() => batch
    ? selectableRoutes.filter((route) => selectedRouteIds.includes(route.id))
    : selectedRoute ? [selectedRoute] : [], [batch, selectableRoutes, selectedRouteIds, selectedRoute]);
  const allRoutesSelected = selectableRoutes.length > 0 && selectedRoutes.length === selectableRoutes.length;
  const selectedSource = onlineSources.find((source) => source.id === sourceId);
  const sourceSupportError = useMemo(() => {
    if (!selectedSource) return '';
    try { validateImportedDownloadSource(selectedSource); return ''; }
    catch (error) { return (error as Error).message || '此图源暂不支持路线缓存'; }
  }, [selectedSource]);

  useEffect(() => {
    if (!routes.some((route) => route.id === routeId)) setRouteId(routes[0]?.id ?? '');
  }, [routes, routeId]);
  useEffect(() => {
    if (!selectableAreas.some((area) => area.id === areaId)) setAreaId(selectableAreas[0]?.id ?? '');
  }, [selectableAreas, areaId]);
  useEffect(() => {
    if (initialAreaId && selectableAreas.some((area) => area.id === initialAreaId)) {
      setCacheMode('area');
      setAreaId(initialAreaId);
      setSetupStep(batch ? 'selectRoutes' : 'route');
    }
  }, [initialAreaId, selectableAreas, batch]);
  useEffect(() => {
    if (routes.length) setSelectedRouteIds((ids) => ids.every((id) => selectableRoutes.some((route) => route.id === id))
      ? ids
      : ids.filter((id) => selectableRoutes.some((route) => route.id === id)));
    if (batch) setSetupStep((step) => step === 'settings' || step === 'source' ? step : 'selectRoutes');
    else setSetupStep((step) => step === 'settings' ? step : 'route');
  }, [batch, routes]);
  useEffect(() => {
    if (!onlineSources.some((source) => source.id === sourceId)) {
      setSourceId('');
      setZoom(14);
    }
  }, [onlineSources, sourceId]);
  useEffect(() => {
    if (selectedSource) setZoom(initialZoom(selectedSource));
  }, [selectedSource?.id]);
  useEffect(() => {
    const sync = () => {
      setOnlyCached(isOfflineOnly());
      setSelectedPackageId(readSelectedPackageId());
    };
    window.addEventListener('shantu:offline-map-mode', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('shantu:offline-map-mode', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const area = useMemo(() => cacheMode === 'area'
    ? selectedArea ? ({ kind: 'polygon' as const, boundary: selectedArea.boundary }) : null
    : selectedRoutes.length
      ? ({ kind: 'route' as const, segments: selectedRoutes.flatMap((route) => route.segments.filter((segment) => segment.length >= 2)), bufferKm })
      : null, [cacheMode, selectedArea, selectedRoutes, bufferKm]);
  type CacheArea = NonNullable<typeof area>;
  const [estimate, setEstimate] = useState<{ plan: Awaited<ReturnType<typeof estimateImportedRouteDownloadAsync>> | null; error: string; pending: boolean; area: CacheArea | null; sourceId: string; zoom: number }>({ plan: null, error: '', pending: false, area: null, sourceId: '', zoom: 0 });
  useEffect(() => {
    if (!area || !selectedSource || sourceSupportError) {
      setEstimate({ plan: null, error: sourceSupportError, pending: false, area, sourceId: selectedSource?.id ?? '', zoom });
      return;
    }
    const controller = new AbortController();
    const tuple = { area, sourceId: selectedSource.id, zoom };
    setEstimate({ ...tuple, plan: null, error: '', pending: true });
    void estimateImportedRouteDownloadAsync(area, selectedSource, zoom, { signal: controller.signal }).then(
      (plan) => setEstimate({ ...tuple, plan, error: '', pending: false }),
      (error) => { if (!controller.signal.aborted) setEstimate({ ...tuple, plan: null, error: (error as Error).message, pending: false }); },
    );
    return () => controller.abort();
  }, [area, selectedSource, sourceSupportError, zoom]);
  const estimateCurrent = estimate.area === area && estimate.sourceId === (selectedSource?.id ?? '') && estimate.zoom === zoom;
  const zooms = selectedSource ? zoomOptions(selectedSource) : [];
  const packages = offline.packages.filter((trip) => trip.provider === 'imported');
  const canExportLegacyArchive = canExportLegacyOfflineArchive();
  const activeTrip = offline.current;
  const availableTrip = (trip: TripPackage) => !!trip.sourceId && onlineSources.some((source) => source.id === trip.sourceId);
  const selectedPackage = packages.find((trip) => trip.id === selectedPackageId && availableTrip(trip));
  const requestedPackageExists = !!focusTripId && packages.some((trip) => trip.id === focusTripId);
  const focusPackageId = requestedPackageExists ? focusTripId
    : activeTrip?.provider === 'imported' && !activeTrip.complete && packages.some((trip) => trip.id === activeTrip.id) ? activeTrip.id : undefined;
  const showProgress = activeTrip?.provider === 'imported' && (offline.busy || !activeTrip.complete || hiddenCompletedTripId !== activeTrip.id);

  useEffect(() => {
    if (tab !== 'packages' || !focusPackageId) return;
    const target = [...(packageListRef.current?.querySelectorAll<HTMLElement>('[data-trip-id]') ?? [])]
      .find((element) => element.dataset.tripId === focusPackageId);
    target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focusPackageId, packages.length, tab]);

  const openTrip = (trip: TripPackage, onlyCached = false) => {
    setOpenError('');
    if (!availableTrip(trip)) {
      setOpenError('原图源已移除或未导入。重新导入原图源后，才能查看或续传此包；现有任务记录和已缓存瓦片已保留。');
      return;
    }
    if (!trip.urls.length || trip.done <= 0) {
      setOpenError('此包尚未下载可查看的地图图像。');
      return;
    }
    try { onOpenMap(trip, onlyCached); }
    catch (error) { setOpenError((error as Error).message || '打开缓存包失败'); }
  };

  const setCacheOnly = (enabled: boolean) => {
    if (enabled && !selectedPackage) return;
    try {
      localStorage.setItem(OFFLINE_MAP_KEY, String(enabled));
      setOnlyCached(enabled);
      window.dispatchEvent(new Event('shantu:offline-map-mode'));
    } catch { setOpenError('缓存模式未能保存，请重试'); }
  };

  const useTripOffline = (trip: TripPackage) => {
    if (!availableTrip(trip) || trip.done <= 0) return;
    // The host also selects the package's source, restores its display settings
    // and fits its bounds. Changing only the cache flags can leave another
    // source selected and make an otherwise valid package look empty.
    openTrip(trip, true);
  };

  const start = () => {
    if ((cacheMode === 'route' && !selectedRoutes.length) || !selectedSource || !area || !estimateCurrent || !estimate.plan || estimate.pending || offline.busy) return;
    if (cacheMode === 'area' && (!selectedArea || !area)) return;
    if (cacheMode === 'route' && !selectedRoutes.length) return;
    setAttemptedStart(true);
    const name = cacheMode === 'area'
      ? selectedArea!.name
      : batch ? `批量路线（${selectedRoutes.length}条）` : selectedRoutes[0].name;
    void offline.createImportedRoute(
      name,
      area,
      selectedSource,
      zoom,
      cacheMode === 'route' ? selectedRoutes.map(route => route.name) : undefined,
    );
  };

  return (
    <section className="route-cache-panel" aria-label="地图缓存" data-step={tab === 'setup' ? setupStep : tab}>
      {initialTab !== 'packages' && (tab === 'packages' || setupStep === 'route') ? <div className="route-cache-tabs" role="tablist" aria-label="缓存页面">
        <button role="tab" aria-selected={tab === 'setup'} onClick={() => setTab('setup')}>新建缓存</button>
        <button role="tab" aria-selected={tab === 'packages'} onClick={() => setTab('packages')}>缓存包 <span>{packages.length}</span></button>
      </div> : null}

      {tab === 'setup' ? (
        <div className="route-cache-setup">
          {showProgress && activeTrip ? (
            <div className="route-cache-progress" aria-live="polite">
              <strong>{activeTrip.name}</strong>
              {activeTrip.urls.length ? <progress value={activeTrip.done} max={activeTrip.urls.length} /> : <progress aria-label="正在规划路线缓存" />}
              {activeTrip.urls.length ? <span>{activeTrip.done}/{activeTrip.urls.length} 项 · {(activeTrip.bytes / 1048576).toFixed(1)} MB</span> : <span>{activeTrip.phaseMessage || '正在规划路线缓存…'}</span>}
              {(activeTrip.phaseMessage || offline.message) && <small>{activeTrip.phaseMessage || offline.message}</small>}
              {activeTrip.complete ? <div className="route-cache-actions">
                <button onClick={() => openTrip(activeTrip)} disabled={!availableTrip(activeTrip) || !activeTrip.urls.length}>查看缓存包</button>
                <button onClick={() => { setHiddenCompletedTripId(activeTrip.id); setSetupStep(batch ? 'selectRoutes' : 'route'); }}>新建缓存</button>
              </div> : offline.busy ? <button onClick={offline.pause}>暂停缓存</button> : (
                <div className="route-cache-actions">
                  <button disabled={!availableTrip(activeTrip) || !activeTrip.urls.length} onClick={() => openTrip(activeTrip)}>查看缓存包</button>
                  <button disabled={activeTrip.complete || !availableTrip(activeTrip)} onClick={() => void offline.resume(activeTrip)}>继续缓存</button>
                </div>
              )}
              {openError && <small className="route-cache-open-error" role="alert">{openError}</small>}
            </div>
          ) : offline.busy ? (
            <div className="route-cache-progress" role="status">{offline.message || '正在准备路线缓存…'}</div>
          ) : routes.length === 0 && selectableAreas.length === 0 ? (
            <div className="route-cache-empty">先绘制、导入或规划一条路线或区域</div>
          ) : (
            <>
              {setupStep === 'selectRoutes' && batch && cacheMode === 'route' ? <>
                <div className="route-cache-mode" aria-label="缓存范围类型">
                  <button type="button" aria-pressed="true">路线缓存</button>
                  <button type="button" aria-pressed="false" onClick={() => setCacheMode('area')}>区域缓存</button>
                </div>
                <div className="route-cache-batch-tools">
                  <span>选择要缓存的路线</span>
                  <button onClick={() => setSelectedRouteIds(allRoutesSelected ? [] : selectableRoutes.map((route) => route.id))}>{allRoutesSelected ? '全不选' : '全选'}</button>
                </div>
                <div className="route-cache-batch-list" aria-label="选择批量缓存路线">
                  {selectableRoutes.map((route) => (
                    <label key={route.id} className="route-cache-batch-row">
                      <input type="checkbox" checked={selectedRouteIds.includes(route.id)} onChange={(event) => setSelectedRouteIds((ids) => event.target.checked ? [...ids, route.id] : ids.filter((id) => id !== route.id))} />
                      <span>{route.name}</span>
                    </label>
                  ))}
                  {!selectableRoutes.length && <small>没有包含有效线段的路线</small>}
                </div>
                <button className="route-cache-primary" disabled={!selectedRoutes.length} onClick={() => setSetupStep('source')}>确认选择 {selectedRoutes.length} 条</button>
              </> : setupStep === 'route' || (setupStep === 'selectRoutes' && batch && cacheMode === 'area') ? <>
                <div className="route-cache-mode" aria-label="缓存范围类型">
                  <button type="button" aria-pressed={cacheMode === 'route'} onClick={() => {
                    setCacheMode('route');
                    if (batch) setSetupStep('selectRoutes');
                  }}>路线缓存</button>
                  <button type="button" aria-pressed={cacheMode === 'area'} onClick={() => {
                    setCacheMode('area');
                    if (batch) setSetupStep('selectRoutes');
                  }} title="按区域内部及边界瓦片缓存">区域缓存</button>
                </div>
                {cacheMode === 'area' ? <>
                  <label className="route-cache-select-row">已画区域
                    <select value={selectedArea?.id ?? ''} onChange={(event) => setAreaId(event.target.value)}>
                      {!selectableAreas.length && <option value="">没有可缓存区域</option>}
                      {selectableAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                    </select>
                  </label>
                </> : batch ? <>
                  <div className="route-cache-batch-tools">
                    <span>选择要缓存的路线</span>
                    <button onClick={() => setSelectedRouteIds(allRoutesSelected ? [] : selectableRoutes.map((route) => route.id))}>{allRoutesSelected ? '全不选' : '全选'}</button>
                  </div>
                  <div className="route-cache-batch-list" aria-label="选择批量缓存路线">
                    {selectableRoutes.map((route) => (
                      <label key={route.id} className="route-cache-batch-row">
                        <input type="checkbox" checked={selectedRouteIds.includes(route.id)} onChange={(event) => setSelectedRouteIds((ids) => event.target.checked ? [...ids, route.id] : ids.filter((id) => id !== route.id))} />
                        <span>{route.name}</span>
                      </label>
                    ))}
                    {!selectableRoutes.length && <small>没有包含有效线段的路线</small>}
                  </div>
                </> : <label className="route-cache-select-row">路线
                  <select value={selectedRoute?.id ?? ''} onChange={(event) => setRouteId(event.target.value)}>
                    {routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
                  </select>
                </label>}
                <button className="route-cache-primary" disabled={cacheMode === 'area' ? !selectedArea : batch ? !selectedRoutes.length : !selectedRoute} onClick={() => setSetupStep('source')}>
                  {cacheMode === 'area' ? '确认区域' : batch ? `确认选择 ${selectedRoutes.length} 条` : '确认路线'}
                </button>
                {cacheMode === 'area' && !selectedArea && <small className="route-cache-step-hint" role="status">先选择一个有效已画区域</small>}
                {cacheMode === 'route' && !batch && !selectedRoute && <small className="route-cache-step-hint" role="status">先选择包含有效线段的路线</small>}
                {cacheMode === 'route' && batch && !selectedRoutes.length && <small className="route-cache-step-hint" role="status">先选择至少一条有效路线</small>}
              </> : setupStep === 'source' ? <>
                <div className="route-cache-batch-summary">
                  <span>{cacheMode === 'area' ? `区域：${selectedArea?.name ?? '未选择'}` : batch ? `已选 ${selectedRoutes.length} 条路线` : `路线：${selectedRoute?.name ?? '未选择'}`}</span>
                  <button className="route-cache-back" onClick={() => setSetupStep(batch ? 'selectRoutes' : 'route')}>修改范围</button>
                </div>
                <label className="route-cache-select-row">自定义图源
                  <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                    <option value="">请选择在线图源</option>
                    {onlineSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                  </select>
                </label>
                {onlineSources.length === 0 ? <div className="route-cache-inline-help"><span>需先导入自定义在线图源。</span><button onClick={onSources}>去导入</button></div> : null}
                <button className="route-cache-primary" disabled={!selectedSource || (cacheMode === 'area' ? !selectedArea : batch ? !selectedRoutes.length : !selectedRoute)} onClick={() => setSetupStep('settings')}>下一步</button>
                {!selectedSource && <small className="route-cache-step-hint" role="status">先选择在线图源，再继续设置缓存</small>}
              </> : <>
                <div className="route-cache-selection-status" role="status">
                  <span>{cacheMode === 'area' ? `区域：${selectedArea?.name ?? '未选择'}` : `路线：${selectedRoutes.map((route) => route.name).join('、')}`}</span>
                  <span>图源：{selectedSource?.name || '未选择'}</span>
                </div>
                {sourceSupportError && <small className="route-cache-source-error" role="alert">此图源不能用于{cacheMode === 'area' ? '区域' : '路线'}缓存：{sourceSupportError}</small>}
                <div className="route-cache-options">
                  {cacheMode === 'route' && <label title="路线两侧缓存范围">两侧
                    <select aria-label="路线两侧" value={bufferKm} onChange={(event) => setBufferKm(Number(event.target.value))}>
                      {widths.map((width) => <option key={width} value={width}>{width}km</option>)}
                    </select>
                  </label>}
                  <label title="最高缓存级别">级别
                    <select aria-label="最高级别" disabled={!selectedSource} value={selectedSource ? zoom : ''} onChange={(event) => setZoom(Number(event.target.value))}>
                      {zooms.map((value) => <option key={value} value={value}>{value} 级</option>)}
                    </select>
                  </label>
                </div>
                <div className="route-cache-estimate" role="status" aria-live="polite" title={`上限 ${MAX_IMPORTED_DOWNLOAD_RESOURCES.toLocaleString()} 项 / ${(MAX_IMPORTED_DOWNLOAD_BYTES / 1024 ** 3).toFixed(0)} GiB；超出时需降低级别或缩小范围`}>
                  {!estimateCurrent || estimate.pending ? `正在估算${cacheMode === 'area' ? '区域' : '路线'}缓存量…` : estimate.error || (estimate.plan ? `预计 ${estimate.plan.count.toLocaleString()} 项 · ${estimatedSize(estimate.plan.estimatedBytes)}` : `选择${cacheMode === 'area' ? '区域' : '路线'}和图源后估算缓存量`)}
                </div>
                <div className="route-cache-settings-actions">
                  <button className="route-cache-primary" disabled={!estimateCurrent || !estimate.plan || estimate.pending || offline.busy} onClick={start}>开始缓存</button>
                  <button className="route-cache-back" onClick={() => setSetupStep('source')}>返回</button>
                </div>
                {attemptedStart && !activeTrip && offline.message && <small className="route-cache-message" role="status">{offline.message}</small>}
                <small className="route-cache-note">{offline.background ? '可后台缓存，进度见通知；会使用网络流量。' : '请保持前台；会使用网络流量。'}</small>
              </>}
            </>
          )}
        </div>
      ) : (
        <div className="route-cache-package-pane">
          {offline.message && <small className="route-cache-message" role="status">{offline.message}</small>}
          {openError && <small className="route-cache-open-error" role="alert">{openError}</small>}
          {onlyCached && !selectedPackage && <div className="route-cache-selected-warning" role="status">
            <span>离线浏览包当前不可用。请选一个可用包，或恢复在线地图。</span>
            <button className="route-cache-back" onClick={() => setCacheOnly(false)}>恢复在线地图</button>
          </div>}
          <div className="route-cache-package-list" ref={packageListRef} aria-label="路线缓存任务列表">
              {packages.length === 0 && <div className="route-cache-empty">还没有路线缓存包</div>}
              {packages.map((trip) => {
                const canOpen = availableTrip(trip) && trip.urls.length > 0 && trip.done > 0 && !offline.removing.includes(trip.id);
                const downloading = offline.busy && activeTrip?.id === trip.id;
                const percent = trip.urls.length ? Math.min(100, Math.floor(trip.done / trip.urls.length * 100)) : 0;
                const routeName = cachedRouteName(trip);
                const sourceAvailable = availableTrip(trip);
                const selectedForOffline = selectedPackageId === trip.id && onlyCached;
                const status = packageProgressLabel(trip, downloading);
                const preview = cachePackagePreview(trip);
                return <article className={`route-cache-package${focusPackageId === trip.id ? ' route-cache-package--focused' : ''}${downloading ? ' route-cache-package--active' : ''}`} key={trip.id} data-trip-id={trip.id} data-active-task={downloading || undefined}>
                  <header className="route-cache-package-heading">
                    <strong title={routeName}>{routeName}</strong>
                    <span className={`route-cache-package-state${trip.phase === 'failed' ? ' is-error' : trip.complete ? ' is-complete' : ''}`} role="status">{status.split(' · ')[0]}</span>
                  </header>
                  <small className="route-cache-package-source">图源：{trip.sourceName ?? '自定义图源'}</small>
                  <small className="route-cache-package-source">{preview.areaGeometry === 'available' ? '含所选区域' : preview.routeGeometry === 'available' ? '含原路线' : '旧包未保留原路线几何'} · 范围为规划边界，非全部已缓存</small>
                  {onPreviewMap && <button className="route-cache-preview" onClick={() => onPreviewMap(trip)} aria-label={`高亮路线与范围：${routeName}`}>高亮路线 / 范围</button>}
                  {!sourceAvailable && <small className="route-cache-package-source-missing" role="status">原图源已移除或未导入；重新导入后可查看、续传。任务记录和已缓存瓦片保留。</small>}
                  <div className="route-cache-package-progress-copy">
                    <span>{status}</span>
                    <span>{percent}%</span>
                  </div>
                  {trip.phase === 'preparing' ? <progress aria-label={`${routeName}正在规划缓存`} /> : <progress aria-label={`${routeName}下载进度`} value={trip.done} max={Math.max(1, trip.urls.length)} />}
                  <div className="route-cache-package-primary-actions">
                    <button className="route-cache-package-open" disabled={!canOpen}
                      aria-label={`查看缓存地图：${routeName}`}
                      title={!sourceAvailable ? '原图源已移除或未导入，重新导入后才能查看' : !trip.urls.length ? '路线缓存清单尚未完成' : trip.done === 0 ? '尚未下载地图图像' : '查看已缓存地图'}
                      onClick={() => openTrip(trip)}>常规浏览</button>
                    {selectedForOffline
                      ? <button className="route-cache-use-offline is-selected" aria-pressed="true" onClick={() => setCacheOnly(false)}>恢复在线地图</button>
                      : <button className="route-cache-use-offline" aria-pressed="false" disabled={!sourceAvailable || trip.done <= 0} title={!sourceAvailable ? '原图源已移除或未导入' : trip.done <= 0 ? '先缓存至少一项地图图像' : '仅浏览此包已缓存图像，禁止联网；地图上可恢复常规浏览'} onClick={() => useTripOffline(trip)}>仅缓存浏览</button>}
                  </div>
                  <div className="route-cache-actions">
                    {downloading ? <button onClick={offline.pause}>暂停</button> : !trip.complete && <button disabled={offline.busy || !availableTrip(trip)} onClick={() => void offline.resume(trip)}>继续</button>}
                    <button disabled={offline.busy} onClick={() => void offline.verify(trip)}>检查完整性</button>
                    {removeConfirmId === trip.id ? (
                      <><button className="route-cache-danger" disabled={offline.removing.includes(trip.id)} onClick={() => { void offline.remove(trip); setRemoveConfirmId(''); }}>确认删除</button><button onClick={() => setRemoveConfirmId('')}>取消</button></>
                    ) : <button className="route-cache-danger" aria-label={`删除缓存：${routeName}`} disabled={offline.removing.includes(trip.id)} onClick={() => setRemoveConfirmId(trip.id)}>删除</button>}
                  </div>
                </article>;
              })}
          {canExportLegacyArchive && <details className="route-cache-archive-details" onToggle={event => {
            if (event.currentTarget.open) event.currentTarget.scrollIntoView({ block: 'nearest' });
          }}>
            <summary>缓存备份与迁入</summary>
            <div className="route-cache-archive-content">
              <span>导出本机私有离线缓存 ZIP。保存后，可在支持该归档的山兔版本中导入。</span>
              <button className="route-cache-archive-action" onClick={() => {
                try { requestLegacyOfflineArchiveExport(); setOpenError('正在准备缓存归档；完成后会打开系统保存窗口。'); }
                catch (error) { setOpenError((error as Error).message || '缓存归档导出失败'); }
              }}>导出缓存 ZIP</button>
            </div>
            </details>}
          </div>
        </div>
      )}
    </section>
  );
}
