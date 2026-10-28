'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Coordinate, PlannedRoute } from '../navigation/types.ts';
import type { LayerSettings, ViewState } from '../map/types.ts';
import { DEFAULT_LAYERS } from '../map/types.ts';
import { NativeTerrainMap } from '../map/native/NativeTerrainMap.tsx';
import type { MapHandle, TerrainMapProps } from '../map/TerrainMap.tsx';
import type { CameraSnapshot } from '../controls/useMapFocusLock.ts';
import { CameraGizmo } from '../controls/CameraGizmo.tsx';
import { INITIAL_GEOLOGY } from '../geology/data.ts';
import type { TrackOverlay } from '../tracks/TrackLayer.ts';
import type { Annotation } from '../annotations/data.ts';
import type { AreaOverlay } from '../areas/AreaLayer.ts';
import type { SectionSettings } from '../section/types.ts';
import type { RoutePlace } from '../navigation/types.ts';
import { basemapConfiguration } from '../cartography/basemaps.ts';
import { usesSentinel, usesTianditu } from '../cartography/sentinel.ts';
import { fitNativeRouteMiniMap, nativeMiniRouteLines, type MiniRouteOption } from './nativeMiniMapGeometry.ts';

type Option = MiniRouteOption & { segments?: PlannedRoute['segments'] };
type Props = {
  coordinates: Coordinate[];
  color?: string;
  routes?: Option[];
  selectedId?: string;
  settings?: LayerSettings;
};

const NOOP = () => {};
const EMPTY_ROUTE = { start: null, end: null, route: null } satisfies TerrainMapProps['routeOverlay'];
const EMPTY_TRACKS = { saved: [], draft: [], visible: false, style: { color: '#436f62', width: 2 }, nodes: [] } as TrackOverlay;
const EMPTY_AREAS: AreaOverlay = { items: [], selected: null, draft: [] };
const EMPTY_SECTION: SectionSettings = { enabled: false, altitude: 0, color: '#ffffff' };

function endpoint(place: Coordinate, kind: 'start' | 'end') {
  const cls = kind === 'start' ? 'is-start' : 'is-end';
  return <span key={kind} className={`route-endpoint-badge ${cls}`} style={{ position: 'absolute', left: place[0], top: place[1], transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>{kind === 'start' ? '起' : '终'}</span>;
}

export function NativeRouteMiniMap({ coordinates, color = '#c2513f', routes, selectedId = 'original', settings }: Props) {
  const mapRef = useRef<MapHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ zoom: 0, pitch: 0, bearing: 0 });
  const [, setProjectionRevision] = useState(0);
  const [initialCamera, setInitialCamera] = useState<CameraSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('底图加载中…');
  const options = routes ?? [{ id: 'original', coordinates, color }];
  const latest = useRef({ options, selectedId, coordinates, view });
  latest.current = { options, selectedId, coordinates, view };
  const lines = useMemo(() => nativeMiniRouteLines(options, selectedId), [options, selectedId]);
  const geometryKey = useMemo(() => JSON.stringify([options, selectedId, coordinates]), [options, selectedId, coordinates]);
  const nativeSettings = useMemo(() => settings
    ? { ...settings, terrain: false }
    : { ...DEFAULT_LAYERS, terrain: false, satellite: true, satelliteProvider: 'sentinel' as const, imageryMode: 'detail' as const }, [settings]);
  const domestic = basemapConfiguration();
  const sentinel = !settings || usesSentinel(settings);
  const tdt = !!settings && usesTianditu(settings, domestic.domestic);
  const attribution = sentinel ? '© EOX · Sentinel 2025 · CC BY-NC-SA' : tdt ? '© 天地图' : '© OpenStreetMap';
  const attributionTitle = sentinel ? 'EOxCloudless · modified Copernicus Sentinel data 2025 · CC BY-NC-SA 4.0' : undefined;

  const fitRoutes = useCallback(() => {
    const element = containerRef.current;
    const handle = mapRef.current;
    if (!element || !handle || !ready) return;
    const fitCoordinates = latest.current.options.map((route) => route.coordinates).filter((points) => points.length >= 2).flat();
    const camera = fitNativeRouteMiniMap(fitCoordinates, element.clientWidth, element.clientHeight, {
      pitch: latest.current.view.pitch,
      bearing: latest.current.view.bearing,
    });
    if (camera) handle.applyCamera(camera);
  }, [ready]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || initialCamera) return;
    const initialize = () => {
      if (initialCamera) return;
      const fitCoordinates = latest.current.options.map((route) => route.coordinates).filter((points) => points.length >= 2).flat();
      const camera = fitNativeRouteMiniMap(fitCoordinates, element.clientWidth, element.clientHeight);
      if (camera) setInitialCamera(camera);
    };
    initialize();
    if (initialCamera || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(initialize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [initialCamera, geometryKey]);

  useEffect(() => { fitRoutes(); }, [fitRoutes, geometryKey]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      fitRoutes();
      setProjectionRevision((revision) => revision + 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitRoutes]);
  useEffect(() => {
    if (!ready) return;
    let previous = '';
    return mapRef.current?.watchObjectProjection((frame) => {
      const fingerprint = JSON.stringify([frame.matrix, frame.width, frame.height]);
      if (fingerprint === previous) return;
      previous = fingerprint;
      setProjectionRevision((revision) => revision + 1);
    });
  }, [ready]);
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(() => setStatus((current) => current === '底图加载中…' ? '底图暂未加载，可重试；路线仍可查看' : current), 15000);
    return () => window.clearTimeout(timer);
  }, [ready]);

  const handleView = (next: ViewState) => setView((previous) => previous.zoom === next.zoom && previous.pitch === next.pitch && previous.bearing === next.bearing ? previous : next);
  const onReady = () => { setReady(true); setStatus(''); };
  const onStatus = (message: string) => {
    if (!message) return;
    if (/瓦片|底图|地图源|加载失败|网络|未同步/.test(message)) setStatus(message);
  };

  const paths = lines.map((line) => {
    const groups: string[][] = [];
    let current: string[] = [];
    for (const coordinate of line.coordinates) {
      const point = mapRef.current?.toScreen(coordinate);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        if (current.length > 1) groups.push(current);
        current = [];
      } else current.push(`${point.x},${point.y}`);
    }
    if (current.length > 1) groups.push(current);
    return groups.map((d, index) => <g key={`${line.key}:${index}`} fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke">
      {line.selected && !line.access && <polyline points={d.join(' ')} stroke="#fff" strokeWidth={7} strokeOpacity={line.opacity} />}
      <polyline points={d.join(' ')} stroke={line.color} strokeWidth={line.selected && !line.access ? 4 : line.width} strokeOpacity={line.opacity} strokeDasharray={line.selected && line.access ? '2 2' : undefined} />
    </g>);
  });
  const start = coordinates[0] ? mapRef.current?.toScreen(coordinates[0]) : null;
  const endCoordinate = coordinates.at(-1);
  const end = endCoordinate ? mapRef.current?.toScreen(endCoordinate) : null;
  const sectionProps: TerrainMapProps = {
    className: 'route-mini-native-map', persistCamera: false, readOnly: true,
    settings: nativeSettings,
    section: EMPTY_SECTION, sectionItems: [], selectedSectionId: null, sectionEditing: false,
    onSectionStatus: NOOP, onSectionChange: NOOP, onSectionProfile: NOOP, onSectionSelect: NOOP,
    sectionCursor: null,
    onPoint: NOOP, onStatus, onSourceStatus: onStatus, onView: handleView, onCameraChange: () => setProjectionRevision((revision) => revision + 1), onReady,
    onSatellite: NOOP, onGeology: NOOP,
    routeOverlay: EMPTY_ROUTE, onMapPick: NOOP,
    trackOverlay: EMPTY_TRACKS, areaOverlay: EMPTY_AREAS, onAreaSelect: NOOP,
    onModelTerrainStatus: NOOP, drawingActive: false, onDrawingInput: NOOP,
    position: null, photos: [], onPhotoSelect: NOOP, onManualRotate: NOOP, onBrowse: NOOP,
    annotations: [] as Annotation[], annotationSelected: null, onAnnotationSelect: NOOP,
    roadSnapping: false, riverSnapping: false, pickingActive: false,
    onTrackSelect: NOOP, onTrackLineSelect: NOOP, onTrackNodeSelect: NOOP,
    onDragBegin: NOOP, onDragPreview: NOOP, onDragCommit: NOOP,
  };

  return <section className="route-mini-overview" aria-label="路线缩略图：选中路线高亮，其他方案淡色显示">
    <div ref={containerRef} className="route-mini-map route-mini-native-surface" style={{ position: 'relative' }}>
      {initialCamera && <NativeTerrainMap {...sectionProps} initialCamera={initialCamera} ref={mapRef} />}
      <svg className="route-mini-native-routes" width="100%" height="100%" aria-hidden="true" focusable="false" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
        {paths}
      </svg>
      {start && endpoint([start.x, start.y], 'start')}
      {end && endpoint([end.x, end.y], 'end')}
    </div>
    <span className="route-mini-north">北 <span style={{ display: 'inline-block', transform: `rotate(${-view.bearing}deg)` }}>↑</span></span>
    <div className="route-mini-controls" aria-label="导航小地图控制">
      <button type="button" aria-label="放大导航小地图" onClick={() => mapRef.current?.zoom(1)}>＋</button>
      <button type="button" aria-label="缩小导航小地图" onClick={() => mapRef.current?.zoom(-1)}>−</button>
      <CameraGizmo view={view} onView={(pitch, bearing) => mapRef.current?.view(pitch, bearing, false)} onGestureView={(pitch, bearing, phase) => mapRef.current?.viewGesture(pitch, bearing, phase)} />
    </div>
    <a href={sentinel ? 'https://cloudless.eox.at' : tdt ? 'https://www.tianditu.gov.cn/' : 'https://www.openstreetmap.org/copyright'} target="_blank" rel="noreferrer" title={attributionTitle}>{attribution}</a>
    {status && <small role="status">{status}<button type="button" onClick={() => { setStatus('底图加载中…'); void mapRef.current?.refreshSatellite(); }}>重试</button></small>}
  </section>;
}
