import { useEffect, useMemo, useState } from 'react';
import type { MapSource } from '../mapSources/types';
import type { Coordinate } from '../navigation/types';
import { MAX_IMPORTED_DOWNLOAD_BYTES, MAX_IMPORTED_DOWNLOAD_RESOURCES } from './importedRouteDownload';
import { estimateImportedRouteDownloadAsync } from './asyncImportedRoutePlan';
import { OFFLINE_MAP_KEY } from './tileCache';
import { canExportLegacyOfflineArchive, requestLegacyOfflineArchiveExport } from './nativeOffline';
import type { TripPackage } from './offline';
import type { useOffline } from './useOffline';
import './routeCachePanel.css';

type RouteCacheRoute = { id: string; name: string; segments: Coordinate[][] };
type Props = {
  routes: RouteCacheRoute[];
  sources: MapSource[];
  offline: ReturnType<typeof useOffline>;
  onOpenMap: (trip: TripPackage) => void;
  onSources: () => void;
  initialRouteId?: string;
  initialTab?: 'setup' | 'packages';
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

export function RouteCachePanel({ routes, sources, offline, onOpenMap, onSources, initialRouteId, initialTab = 'setup', batch = false, initialRouteIds = [] }: Props) {
  const onlineSources = useMemo(() => sources.filter((source) => source.kind === 'online'), [sources]);
  const [tab, setTab] = useState<'setup' | 'packages'>(initialTab);
  const [setupStep, setSetupStep] = useState<'selectRoutes' | 'route' | 'source' | 'settings'>(() => batch ? 'selectRoutes' : 'route');
  const [routeId, setRouteId] = useState(initialRouteId ?? routes[0]?.id ?? '');
  const [selectedRouteIds, setSelectedRouteIds] = useState<string[]>(initialRouteIds);
  const [sourceId, setSourceId] = useState('');
  const [bufferKm, setBufferKm] = useState(4);
  const [zoom, setZoom] = useState(14);
  const [onlyCached, setOnlyCached] = useState(isOfflineOnly);
  const [removeConfirmId, setRemoveConfirmId] = useState('');
  const [hiddenCompletedTripId, setHiddenCompletedTripId] = useState(offline.current?.complete ? offline.current.id : '');
  const [openError, setOpenError] = useState('');
  const [attemptedStart, setAttemptedStart] = useState(false);
  const selectedRoute = routes.find((route) => route.id === routeId) ?? routes[0];
  const selectableRoutes = useMemo(() => routes.filter((route) => route.segments.some((segment) => segment.length >= 2)), [routes]);
  const selectedRoutes = useMemo(() => batch
    ? selectableRoutes.filter((route) => selectedRouteIds.includes(route.id))
    : selectedRoute ? [selectedRoute] : [], [batch, selectableRoutes, selectedRouteIds, selectedRoute]);
  const allRoutesSelected = selectableRoutes.length > 0 && selectedRoutes.length === selectableRoutes.length;
  const selectedSource = onlineSources.find((source) => source.id === sourceId);

  useEffect(() => {
    if (!routes.some((route) => route.id === routeId)) setRouteId(routes[0]?.id ?? '');
  }, [routes, routeId]);
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
    const sync = () => setOnlyCached(isOfflineOnly());
    window.addEventListener('shantu:offline-map-mode', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('shantu:offline-map-mode', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const area = useMemo(() => selectedRoutes.length ? ({ kind: 'route' as const, segments: selectedRoutes.flatMap((route) => route.segments.filter((segment) => segment.length >= 2)), bufferKm }) : null, [selectedRoutes, bufferKm]);
  const [estimate, setEstimate] = useState<{ plan: Awaited<ReturnType<typeof estimateImportedRouteDownloadAsync>> | null; error: string; pending: boolean; area: typeof area; sourceId: string; zoom: number }>({ plan: null, error: '', pending: false, area: null, sourceId: '', zoom: 0 });
  useEffect(() => {
    if (!area || !selectedSource) { setEstimate({ plan: null, error: '', pending: false, area, sourceId: selectedSource?.id ?? '', zoom }); return; }
    const controller = new AbortController();
    const tuple = { area, sourceId: selectedSource.id, zoom };
    setEstimate({ ...tuple, plan: null, error: '', pending: true });
    void estimateImportedRouteDownloadAsync(area, selectedSource, zoom, { signal: controller.signal }).then(
      (plan) => setEstimate({ ...tuple, plan, error: '', pending: false }),
      (error) => { if (!controller.signal.aborted) setEstimate({ ...tuple, plan: null, error: (error as Error).message, pending: false }); },
    );
    return () => controller.abort();
  }, [area, selectedSource, zoom]);
  const estimateCurrent = estimate.area === area && estimate.sourceId === (selectedSource?.id ?? '') && estimate.zoom === zoom;
  const zooms = selectedSource ? zoomOptions(selectedSource) : [];
  const packages = offline.packages.filter((trip) => trip.provider === 'imported');
  const canExportLegacyArchive = canExportLegacyOfflineArchive();
  const activeTrip = offline.current;
  const availableTrip = (trip: TripPackage) => !!trip.sourceId && onlineSources.some((source) => source.id === trip.sourceId);
  let selectedPackageId = '';
  try { selectedPackageId = localStorage.getItem('shantu.offline-package.v1') ?? ''; } catch { /* Storage may be unavailable. */ }
  const selectedPackage = packages.find((trip) => trip.id === selectedPackageId && availableTrip(trip));
  const showProgress = activeTrip?.provider === 'imported' && (offline.busy || !activeTrip.complete || hiddenCompletedTripId !== activeTrip.id);

  const openTrip = (trip: TripPackage) => {
    setOpenError('');
    try { onOpenMap(trip); }
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

  const start = () => {
    if (!selectedRoutes.length || !selectedSource || !area || !estimateCurrent || !estimate.plan || estimate.pending || offline.busy) return;
    setAttemptedStart(true);
    const name = batch ? `批量路线（${selectedRoutes.length}条）` : selectedRoutes[0].name;
    void offline.createImportedRoute(name, area, selectedSource, zoom, selectedRoutes.map(route => route.name));
  };

  return (
    <section className="route-cache-panel" aria-label="沿轨迹路线缓存">
      {initialTab !== 'packages' && (tab === 'packages' || (setupStep !== 'settings' && setupStep !== 'selectRoutes')) ? <div className="route-cache-tabs" role="tablist" aria-label="缓存页面">
        <button role="tab" aria-selected={tab === 'setup'} onClick={() => setTab('setup')}>沿线缓存</button>
        <button role="tab" aria-selected={tab === 'packages'} onClick={() => setTab('packages')}>缓存包 <span>{packages.length}</span></button>
      </div> : null}

      {tab === 'setup' ? (
        <div className="route-cache-setup">
          {showProgress && activeTrip ? (
            <div className="route-cache-progress" aria-live="polite">
              <strong>{activeTrip.name}</strong>
              <progress value={activeTrip.done} max={Math.max(1, activeTrip.urls.length)} />
              <span>{activeTrip.done}/{activeTrip.urls.length} 项 · {(activeTrip.bytes / 1048576).toFixed(1)} MB</span>
              {offline.message && <small>{offline.message}</small>}
              {activeTrip.complete ? <div className="route-cache-actions">
                <button onClick={() => openTrip(activeTrip)} disabled={!availableTrip(activeTrip)}>查看缓存包</button>
                <button onClick={() => { setHiddenCompletedTripId(activeTrip.id); setSetupStep(batch ? 'selectRoutes' : 'route'); }}>新建缓存</button>
              </div> : offline.busy ? <button onClick={offline.pause}>暂停缓存</button> : (
                <div className="route-cache-actions">
                  <button disabled={!availableTrip(activeTrip)} onClick={() => openTrip(activeTrip)}>查看缓存包</button>
                  <button disabled={activeTrip.complete || !availableTrip(activeTrip)} onClick={() => void offline.resume(activeTrip)}>继续缓存</button>
                </div>
              )}
              {openError && <small className="route-cache-open-error" role="alert">{openError}</small>}
            </div>
          ) : offline.busy ? (
            <div className="route-cache-progress" role="status">{offline.message || '正在准备路线缓存…'}</div>
          ) : routes.length === 0 ? (
            <div className="route-cache-empty">先绘制、导入或规划一条路线</div>
          ) : (
            <>
              {setupStep === 'selectRoutes' && batch ? <>
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
              </> : setupStep === 'route' ? <>
                <label className="route-cache-select-row">路线
                  <select value={selectedRoute?.id ?? ''} onChange={(event) => setRouteId(event.target.value)}>
                    {routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
                  </select>
                </label>
                <label className="route-cache-select-row">自定义图源
                  <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                    <option value="">请选择在线图源</option>
                    {onlineSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                  </select>
                </label>
                {onlineSources.length === 0 ? <div className="route-cache-inline-help"><span>需先导入自定义在线图源。</span><button onClick={onSources}>去导入</button></div> : null}
                <button className="route-cache-primary" disabled={!selectedRoute || !selectedSource} onClick={() => setSetupStep('settings')}>下一步</button>
              </> : setupStep === 'source' && batch ? <>
                <div className="route-cache-batch-summary"><span>已选 {selectedRoutes.length} 条路线</span><button onClick={() => setSetupStep('selectRoutes')}>修改选择</button></div>
                <label className="route-cache-select-row">自定义图源
                  <select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
                    <option value="">请选择在线图源</option>
                    {onlineSources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
                  </select>
                </label>
                {onlineSources.length === 0 ? <div className="route-cache-inline-help"><span>需先导入自定义在线图源。</span><button onClick={onSources}>去导入</button></div> : null}
                <button className="route-cache-primary" disabled={!selectedRoutes.length || !selectedSource} onClick={() => setSetupStep('settings')}>下一步</button>
              </> : <>
                <div className="route-cache-options">
                  <label>路线两侧
                    <select value={bufferKm} onChange={(event) => setBufferKm(Number(event.target.value))}>
                      {widths.map((width) => <option key={width} value={width}>各 {width} km</option>)}
                    </select>
                  </label>
                  <label>最高级别
                    <select disabled={!selectedSource} value={selectedSource ? zoom : ''} onChange={(event) => setZoom(Number(event.target.value))}>
                      {zooms.map((value) => <option key={value} value={value}>{value} 级{value === selectedSource?.maxzoom ? '（上限）' : ''}</option>)}
                    </select>
                  </label>
                </div>
                <div className="route-cache-estimate" role="status" aria-live="polite">
                  {!estimateCurrent || estimate.pending ? '正在后台估算路线缓存量…' : estimate.error || (estimate.plan ? `预计 ${estimate.plan.count.toLocaleString()} 项图源请求 · ${estimatedSize(estimate.plan.estimatedBytes)}（上限 ${MAX_IMPORTED_DOWNLOAD_RESOURCES.toLocaleString()} 项 / ${(MAX_IMPORTED_DOWNLOAD_BYTES / 1024 ** 3).toFixed(0)} GiB）` : '选择路线和图源后估算缓存量')}
                </div>
                <div className="route-cache-settings-actions">
                  <button className="route-cache-primary" disabled={!estimateCurrent || !estimate.plan || estimate.pending || offline.busy} onClick={start}>开始缓存</button>
                  <button className="route-cache-back" onClick={() => setSetupStep(batch ? 'source' : 'route')}>返回</button>
                </div>
                {attemptedStart && !activeTrip && offline.message && <small className="route-cache-message" role="status">{offline.message}</small>}
                <small className="route-cache-note">{offline.background ? '后台 16 路下载，进度见通知；计入图源额度。' : '保持前台 16 路下载；计入图源额度。'}</small>
              </>}
            </>
          )}
        </div>
      ) : (
        <div className="route-cache-package-pane">
          {offline.message && <small className="route-cache-message" role="status">{offline.message}</small>}
          {openError && <small className="route-cache-open-error" role="alert">{openError}</small>}
          {canExportLegacyArchive && <div className="route-cache-inline-help" role="group" aria-label="迁移旧版离线缓存">
            <span>将此旧版 APK 私有缓存导出为 ZIP；在新应用的“本地离线地图”中选择“迁入旧版离线缓存归档”。确认新应用已导入后，再决定是否移除旧版安装。</span>
            <button onClick={() => {
              try { requestLegacyOfflineArchiveExport(); setOpenError('正在打包旧版离线缓存；完成后会打开系统保存窗口，请将ZIP保存到新应用可访问的位置。'); }
              catch (error) { setOpenError((error as Error).message || '旧版缓存导出失败'); }
            }}>导出旧版缓存 ZIP</button>
          </div>}
          <label className="route-cache-only">
            <input type="checkbox" checked={onlyCached && !!selectedPackage} disabled={!selectedPackage} onChange={(event) => setCacheOnly(event.target.checked)} />
            仅显示缓存图像
          </label>
          {!selectedPackage && <small className="route-cache-cache-hint">请先点选一个可用缓存包，再启用仅缓存显示。</small>}
          {onlyCached && <button className="route-cache-online" onClick={() => setCacheOnly(false)}>恢复在线地图</button>}
          {packages.length === 0 ? <div className="route-cache-empty">还没有沿线缓存包</div> : (
            <div className="route-cache-package-list">
              {packages.map((trip) => {
                const canOpen = availableTrip(trip) && trip.done > 0 && !offline.removing.includes(trip.id);
                const downloading = offline.busy && activeTrip?.id === trip.id;
                const percent = trip.urls.length ? Math.min(100, Math.round(trip.done / trip.urls.length * 100)) : 0;
                const routeName = cachedRouteName(trip);
                return <article className="route-cache-package" key={trip.id}>
                  <button className="route-cache-package-open" disabled={!canOpen}
                    aria-label={`显示缓存地图：${routeName}`}
                    title={!availableTrip(trip) ? '原图源不可用，请重新导入后再查看' : trip.done === 0 ? '尚未下载地图图像' : '点击显示缓存地图'}
                    onClick={() => openTrip(trip)}>
                    <strong>{routeName}</strong>
                    <span>图源：{trip.sourceName ?? '自定义图源'}</span>
                    <span title="本包已缓存瓦片大小；不同包共用的瓦片只存储一份">占用空间：{cachedSize(trip.bytes)}</span>
                    <span>下载进度：{percent}% · {trip.done}/{trip.urls.length} · {trip.complete ? '已完成' : downloading ? '下载中' : '未完成'}</span>
                    <progress aria-label="下载进度" value={trip.done} max={Math.max(1, trip.urls.length)} />
                  </button>
                  <div className="route-cache-actions">
                    {downloading ? <button onClick={offline.pause}>暂停</button> : !trip.complete && <button disabled={offline.busy || !availableTrip(trip)} onClick={() => void offline.resume(trip)}>继续</button>}
                    <button disabled={offline.busy} onClick={() => void offline.verify(trip)}>检查完整性</button>
                    {removeConfirmId === trip.id ? (
                      <><button className="route-cache-danger" disabled={offline.removing.includes(trip.id)} onClick={() => { void offline.remove(trip); setRemoveConfirmId(''); }}>确认删除</button><button onClick={() => setRemoveConfirmId('')}>取消</button></>
                    ) : <button className="route-cache-danger" aria-label={`删除缓存：${routeName}`} disabled={offline.removing.includes(trip.id)} onClick={() => setRemoveConfirmId(trip.id)}>删除</button>}
                  </div>
                </article>;
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
