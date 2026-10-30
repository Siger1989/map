'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { getSharedNativeMapClient, NativeMapBridgeError } from './client.ts';
import type { NativeMapBridgeClient } from './client.ts';
import { configureNativeUIRegionTransport } from '../../../mobile/native-ui-regions.ts';
import { prepareNativeMapSource } from './assets.ts';
import { createNativeSceneGeometry } from './scene.ts';
import { createNativeShareStyle } from './share.ts';
import { readNativeCadGeometry } from './cad.ts';
import type { FeatureCollection } from 'geojson';
import { CAD_CHANGED } from '../../cad/storage.ts';
import { NativeMapInteractionAdapter, type NativeHitTest } from './interaction.ts';
import { projectNativeLocal, unprojectNativeLocal } from './localGeometry.ts';
import { prepareVisibleNodeMove } from '../../tracks/visibleNodeMove.ts';
import { readNativeOfflineDisplayPolicy, subscribeNativeOfflineDisplayPolicy } from './offlineMode.ts';
import type { NativeOfflineDisplayPolicyPayload } from './offlineMode.ts';
import { nativeAnchoredGesture, nativeFocusCamera, nativeFocusPositionCamera, nativeNavigationCamera, nativePreviewNavigationCamera, nativeRouteGapCamera, nativeRouteIssueCamera, nativeViewCamera } from './camera.ts';
import { NativeTransientGeometry } from './transientGeometry.ts';
import { PROFILE_NOTES_CHANGED, PROFILE_NOTES_KEY } from '../../section/profileNotes.ts';
import type { ProfileNote } from '../../section/profileNotes.ts';
import { readNativeProfileNotesRaw, sectionSettingsWithNativeNotes, type NativeProfileNotesPreview } from './sectionNotes.ts';
import { advanceNativeFollowGesture, beginNativeFollowGesture, type NativeFollowGesture } from './followGesture.ts';
import { installNativeBrowserCacheBridge } from './browserCacheBridge.ts';
import { NativeCameraSync } from './cameraSync.ts';
import { NativeCameraPersistence } from './cameraPersistence.ts';
import { NativeProjectionSyncScheduler, nativePhotoGroupKey, subscribeNativeProjectionEvents } from './projectionSyncScheduler.ts';
import { NativeInitializationRetry } from './initializationRetry.ts';
import { serializeNativeMapPhoto } from './photoWire.ts';
import { shouldNotifyNativeMapReady } from './readiness.ts';
import { interpretNativeTap } from './tapSemantics.ts';
import type { NativeTapPick } from './tapSemantics.ts';
import { NativeAnnotationNavigation } from './NativeAnnotationNavigation.tsx';
import { invalidateNativeDrawingGroundHit, nativeDrawingCoordinateAt, updateNativeDrawingGroundHit } from './drawingGroundHit.ts';
import type { NativeDrawingGroundHit } from './drawingGroundHit.ts';
import type { NativeMapPhoto, NativeMapRenderState, NativeMapViewport, NativeProjectionFrame } from './types.ts';
import { INITIAL_VIEW } from '../types.ts';
import { readLastView, saveLastView } from '../lastView.ts';
import type { MapHandle, NavigationCameraRequest, TerrainMapProps } from '../TerrainMap.tsx';
import type { CameraSnapshot } from '../../controls/useMapFocusLock.ts';
import type { Coordinate } from '../../navigation/types.ts';
import { coordinate } from '../../navigation/types.ts';
import type { ScreenPoint } from '../../tracks/drawing.ts';
import type { TrackOverlay } from '../../tracks/TrackLayer.ts';
import type { TrackContinuationHit } from '../../tracks/prepareTrackContinuation.ts';
import { pickTrackContinuation } from '../../tracks/prepareTrackContinuation.ts';
import { DRAFT_ID } from '../../tracks/editing.ts';
import type { TrackRenderReceipt, TrackRenderHandoffResult } from '../../tracks/trackRenderHandoff.ts';
import type { RoadLine, RoadMatch, RoadSnapResult, RoadSnapper } from '../../tracks/roadSnapping.ts';
import { nearestRoad } from '../../tracks/roadSnapping.ts';
import { riverLines } from '../../tracks/riverSnapping.ts';
import { roadLines as readRoadLines } from '../../tracks/roadSnapping.ts';
import { roadPath } from '../../tracks/roadPath.ts';
import type { SnapViewport } from '../../tracks/snapping.ts';
import type { ProjectionFrame, WatchProjection } from '../../objectTransform/projection.ts';
import type { VisiblePhoto } from '../../photos/storage.ts';
import type { MapSource } from '../../mapSources/types.ts';
import type { ShareMapStyle } from '../../routeShare/currentMapStyle.ts';
import type { TripPackage } from '../../outdoor/offline.ts';
import type { RouteGap } from '../../tracks/routeInfo.ts';
import type { DragTarget, FeatureMove } from '../FeatureDragBridge.ts';
import type { DrawingInput } from '../../tracks/DrawingGestureBridge.ts';
import { pickLinePoint, type TrackLinePoint } from '../../tracks/linePoint.ts';
import type { TrackNode } from '../../tracks/editing.ts';
import type { SectionProfileData } from '../../section/contours.ts';
import type { SectionStatus } from '../../section/types.ts';
import type { GeologyState } from '../../geology/data.ts';
import { INITIAL_GEOLOGY } from '../../geology/data.ts';
import type { SatelliteState } from '../../satellite/satellite.ts';
import type { ViewState } from '../types.ts';

type AnyRecord = Record<string, unknown>;
const TRUSTED_ORIGINS = ['https://appassets.androidplatform.net'] as const;
const MAX_RENDER_STATE_BYTES = 7.5 * 1024 * 1024;
const PREVIEW_MAX_SIDE = 128;
const PREVIEW_MIME = 'image/webp';
const PREVIEW_QUALITY = 0.85;

let sharedClient: NativeMapBridgeClient | null = null;
let sharedConnectFlight: Promise<unknown> | null = null;
let uiRegionConfiguredFor: NativeMapBridgeClient | null = null;
const leasedMapIds = new Set<string>();
let nextAuxiliaryId = 1;
const previewCache = new WeakMap<Blob, Promise<string>>();
let nextMapOwnerGeneration = 1;

function getClient(): NativeMapBridgeClient {
  const client = getSharedNativeMapClient({ trustedOrigins: TRUSTED_ORIGINS });
  sharedClient = client;
  if (uiRegionConfiguredFor !== client) {
    configureNativeUIRegionTransport({
      getSessionId: () => client.sessionId,
      send: ({ command, payload }) => client.notify('main', command, payload),
    });
    uiRegionConfiguredFor = client;
  }
  return client;
}

function connect(client: NativeMapBridgeClient) {
  if (client.isReady) return Promise.resolve();
  if (!sharedConnectFlight) {
    sharedConnectFlight = client.connect('main').finally(() => { sharedConnectFlight = null; });
  }
  return sharedConnectFlight;
}

function leaseMapId(className: string | undefined): string {
  const role = className?.split(/\s+/).find((part) => part === 'map-comparison-primary' || part === 'map-comparison-secondary');
  if (role === 'map-comparison-primary' && !leasedMapIds.has('main')) {
    leasedMapIds.add('main');
    return 'main';
  }
  if (role === 'map-comparison-secondary' && !leasedMapIds.has('aux-1')) {
    leasedMapIds.add('aux-1');
    return 'aux-1';
  }
  if (!leasedMapIds.has('main')) {
    leasedMapIds.add('main');
    return 'main';
  }
  while (leasedMapIds.has(`aux-${nextAuxiliaryId}`)) nextAuxiliaryId++;
  const id = `aux-${nextAuxiliaryId++}`;
  leasedMapIds.add(id);
  return id;
}

function parseCamera(value: unknown): CameraSnapshot | null {
  if (!isRecord(value)) return null;
  const camera = isRecord(value.camera) ? value.camera : value;
  const center = camera.center;
  if (!Array.isArray(center) || center.length < 2) return null;
  const [lng, lat] = center;
  const zoom = camera.zoom, pitch = camera.pitch, bearing = camera.bearing;
  if (![lng, lat, zoom, pitch, bearing].every((n) => typeof n === 'number' && Number.isFinite(n)) ||
      Math.abs(lat as number) > 90 || (zoom as number) < 0 || (pitch as number) < 0 || (pitch as number) > 80) return null;
  const detailZoom = typeof camera.detailZoom === 'number' && Number.isFinite(camera.detailZoom) ? camera.detailZoom : undefined;
  return { center: [lng as number, lat as number], zoom: zoom as number, pitch: pitch as number, bearing: bearing as number, ...(detailZoom === undefined ? {} : { detailZoom }) };
}

function hashCamera(): CameraSnapshot | null {
  const raw = typeof window === 'undefined' ? '' : window.location.hash.slice(1).split('&')[0];
  const values = raw.split('/').map(Number);
  if (values.length < 3 || values.some((v) => !Number.isFinite(v))) return null;
  const [zoom, lat, lng, bearing = 0, pitch = 0] = values;
  if (zoom! < 0 || zoom! > 20 || Math.abs(lat!) > 85.051129 || pitch! < 0 || pitch! > 80) return null;
  return { center: [lng!, lat!], zoom: zoom!, bearing: bearing!, pitch: pitch! };
}

function initialCamera(props: TerrainMapProps): CameraSnapshot {
  if (props.initialCamera) return props.initialCamera;
  if (props.persistCamera !== false) {
    const fromHash = hashCamera();
    if (fromHash) return fromHash;
    const saved = readLastView();
    if (saved) return saved;
  }
  return INITIAL_VIEW;
}

function writeCameraHash(camera: CameraSnapshot): void {
  const zoom = Math.round(camera.zoom * 100) / 100;
  const precision = Math.ceil((zoom * Math.LN2 + Math.log(512 / 360 / 0.5)) / Math.LN10);
  const multiplier = 10 ** precision;
  const lng = Math.round(camera.center[0] * multiplier) / multiplier;
  const lat = Math.round(camera.center[1] * multiplier) / multiplier;
  let next = `${zoom}/${lat}/${lng}`;
  if (camera.bearing || camera.pitch) next += `/${Math.round(camera.bearing * 10) / 10}`;
  if (camera.pitch) next += `/${Math.round(camera.pitch)}`;
  const url = `${window.location.pathname}${window.location.search}#${next}`;
  window.history.replaceState(window.history.state, '', url);
}

function isRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPoint(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length < 2 || !coordinate(value)) return null;
  return [value[0], value[1]];
}

function blobToBase64(blob: Blob): Promise<string> {
  let cached = previewCache.get(blob);
  if (cached) return cached;
  cached = createMapPreview(blob).then((preview) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) reject(new Error('照片地图缩略图编码失败'));
      else resolve(dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error('照片地图缩略图读取失败'));
    reader.readAsDataURL(preview);
  })).catch((error) => { previewCache.delete(blob); throw error; });
  previewCache.set(blob, cached);
  return cached;
}

async function createMapPreview(blob: Blob): Promise<Blob> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建照片地图缩略图画布');
      context.drawImage(bitmap, 0, 0, width, height);
      const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('照片地图缩略图编码失败')), PREVIEW_MIME, PREVIEW_QUALITY));
      if (output.size > 128 * 1024) throw new Error('单张照片地图缩略图超过128 KiB');
      return output;
    } finally { bitmap.close(); }
  }
  // Older WebView fallback still resizes the actual Blob; it never serializes its object URL.
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const value = new Image();
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error('无法解码照片地图缩略图'));
      value.src = url;
    });
    const scale = Math.min(1, PREVIEW_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建照片地图缩略图画布');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const output = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('照片地图缩略图编码失败')), PREVIEW_MIME, PREVIEW_QUALITY));
    if (output.size > 128 * 1024) throw new Error('单张照片地图缩略图超过128 KiB');
    return output;
  } finally { URL.revokeObjectURL(url); }
}

function cssViewport(element: HTMLElement): NativeMapViewport {
  const rect = element.getBoundingClientRect();
  return {
    cssRect: { x: rect.left, y: rect.top, width: Math.max(0, rect.width), height: Math.max(0, rect.height) },
    devicePixelRatio: window.devicePixelRatio || 1,
    clientViewportWidth: document.documentElement.clientWidth || window.innerWidth,
  };
}

function groupNativePhotos(photos: VisiblePhoto[], client: NativeMapBridgeClient, mapId: string, viewport: NativeMapViewport): Array<{ photo: VisiblePhoto; groupIds: string[] }> {
  const frame = client.cameraFrame(mapId);
  if (!frame || viewport.cssRect.width <= 0 || viewport.cssRect.height <= 0) return [];
  const center = frame.camera.center;
  const metersPerPixel = 40075016.68557849 * Math.cos(center[1] * Math.PI / 180) / (512 * 2 ** frame.camera.zoom);
  const radius = Math.max(150, metersPerPixel * Math.hypot(viewport.cssRect.width, viewport.cssRect.height) * 0.6) * 0.9;
  const groups = new Map<string, Array<{ photo: VisiblePhoto; point: ScreenPoint }>>();
  for (const photo of photos) {
    const distance = greatCircleMeters(center, photo.coordinates);
    if (Number.isFinite(radius) && distance > radius) continue;
    const projected = projectNativeLocal(client, mapId, photo.coordinates);
    if (!projected) continue;
    const { x, y } = projected;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < -50 || y < -50 || x > viewport.cssRect.width + 50 || y > viewport.cssRect.height + 50) continue;
    const key = photo.kind === 'annotation'
      ? `marker:${photo.annotationId ?? photo.id}`
      : `grid:${Math.floor(x / 60)}/${Math.floor(y / 60)}`;
    const group = groups.get(key) ?? [];
    group.push({ photo, point: { x, y } });
    groups.set(key, group);
  }
  return [...groups.values()].map((members) => ({ photo: members[0]!.photo, groupIds: members.map(({ photo }) => photo.id) }));
}

function greatCircleMeters(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const lat1 = a[1] * radians, lat2 = b[1] * radians;
  const deltaLat = lat2 - lat1;
  const deltaLng = (((b[0] - a[0] + 540) % 360) - 180) * radians;
  const sinLat = Math.sin(deltaLat / 2), sinLng = Math.sin(deltaLng / 2);
  const h = Math.min(1, Math.max(0, sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng));
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function sceneGeometry(runtime: Runtime, props: TerrainMapProps): ReturnType<typeof createNativeSceneGeometry> {
  const cache = runtime.sceneCache;
  const preview = runtime.previewTrackOverride ? runtime.previewTrack : props.trackOverlay.preview ?? null;
  const positionCoordinates = props.position?.coordinates ?? null;
  if (cache && cache.tracks === props.trackOverlay && cache.preview === preview && cache.guidance === props.guidanceOverlay && cache.cues === props.navigationCues &&
      cache.route === props.routeOverlay && cache.positionCoordinates === positionCoordinates && cache.positionNavigating === props.positionNavigating) return cache.geometry;
  const trackOverlay = preview === props.trackOverlay.preview ? props.trackOverlay : { ...props.trackOverlay, preview };
  const geometry = createNativeSceneGeometry({ ...props, trackOverlay });
  runtime.sceneCache = { tracks: props.trackOverlay, preview, guidance: props.guidanceOverlay, cues: props.navigationCues,
    route: props.routeOverlay, positionCoordinates, positionNavigating: props.positionNavigating, geometry };
  return geometry;
}

async function prepareMapSource(runtime: Runtime, client: NativeMapBridgeClient, mapId: string, source: MapSource | null | undefined, signal: AbortSignal) {
  const requested = source ?? null;
  if (runtime.preparedMapSourceMapId === mapId && runtime.mapSourceRef === requested && runtime.preparedMapSource !== undefined) return runtime.preparedMapSource;
  const prepared = await prepareNativeMapSource(client, mapId, requested, signal);
  signal.throwIfAborted();
  runtime.mapSourceRef = requested;
  runtime.preparedMapSourceMapId = mapId;
  runtime.preparedMapSource = prepared;
  return prepared;
}

function pointFromProjection(client: NativeMapBridgeClient, mapId: string, coordinateValue: Coordinate): ScreenPoint | null {
  return projectNativeLocal(client, mapId, coordinateValue);
}

function fromLocalScreen(client: NativeMapBridgeClient, mapId: string, point: ScreenPoint): Coordinate | null {
  return unprojectNativeLocal(client, mapId, point);
}

function navigationUsableRect(runtime: Runtime): { height: number; usableRect?: { top: number; bottom: number } } {
  const container = runtime.element;
  const fallbackHeight = runtime.viewport?.cssRect.height ?? 0;
  if (!container) return { height: fallbackHeight };
  const bounds = container.getBoundingClientRect();
  const height = container.clientHeight || bounds.height || fallbackHeight;
  const verticalScale = bounds.height > 0 ? height / bounds.height : 1;
  const host = container.closest<HTMLElement>('.observatory.home-map');
  let top = 0, bottom = height;
  const centerX = bounds.left + bounds.width / 2, centerY = bounds.top + bounds.height / 2;
  const blockers = Array.from(host?.querySelectorAll<HTMLElement>(
    '.guidance-card, .navigation-live-strip, .home-bottom-nav, .navigation-elevation .rally-elevation, .route-weather-rail, .map-legends > *',
  ) ?? []);
  const routePanel = host?.querySelector<HTMLElement>('.control-dock.is-expanded #map-control-panel .route-panel');
  const routePanelBounds = routePanel?.closest<HTMLElement>('#map-control-panel');
  if (routePanelBounds) blockers.push(routePanelBounds);
  for (const blocker of blockers) {
    if (blocker.hidden || getComputedStyle(blocker).display === 'none' || getComputedStyle(blocker).visibility === 'hidden') continue;
    const rect = blocker.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || centerX < rect.left || centerX > rect.right) continue;
    const relativeTop = (rect.top - bounds.top) * verticalScale;
    const relativeBottom = (rect.bottom - bounds.top) * verticalScale;
    if (relativeTop <= height / 2 && relativeBottom > height / 2) {
      const roomAbove = Math.max(0, relativeTop), roomBelow = Math.max(0, height - relativeBottom);
      if (roomBelow >= roomAbove) top = Math.max(top, relativeBottom);
      else bottom = Math.min(bottom, relativeTop);
    } else if (relativeBottom <= height / 2) top = Math.max(top, relativeBottom);
    else if (relativeTop > height / 2) bottom = Math.min(bottom, relativeTop);
  }
  return { height, usableRect: { top: Math.min(top, height), bottom: Math.max(0, Math.min(bottom, height)) } };
}

function localProjectionFrame(frame: NativeProjectionFrame): NativeProjectionFrame {
  return { ...frame, viewport: { ...frame.viewport, x: 0, y: 0 } };
}

function eventMessage(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return null;
  return typeof value.message === 'string' ? value.message : typeof value.status === 'string' ? value.status : null;
}

function safeCallback(run: () => void) {
  try { run(); } catch { /* App callbacks must not interrupt bridge event delivery. */ }
}

function chooseCamera(value: unknown): CameraSnapshot | null {
  if (!isRecord(value)) return null;
  return parseCamera(value.camera) ?? parseCamera(value);
}

function readLines(value: unknown, kind: 'road' | 'river'): RoadLine[] | null {
  if (!isRecord(value) || !Array.isArray(value.lines)) return null;
  const features = value.lines.flatMap((line, index) => {
    if (!isRecord(line) || !Array.isArray(line.coordinates)) return [];
    return [{
      properties: { class: typeof line.class === 'string' ? line.class : kind === 'river' ? 'river' : 'path', name: line.name, layer: line.level },
      geometry: { type: 'LineString', coordinates: line.coordinates },
      id: typeof line.id === 'string' ? line.id : index,
    }];
  });
  const lines = kind === 'river' ? riverLines(features) : readRoadLines(features);
  return lines.length ? lines : [];
}

function applySnapGeometry(runtime: Runtime, value: unknown) {
  if (!isRecord(value)) return;
  runtime.snapGeometryRevision = Number.isSafeInteger(value.cameraRevision) ? value.cameraRevision as number : null;
  for (const kind of ['road', 'river'] as const) {
    const source = value[kind];
    if (!isRecord(source) || !['ready', 'loading', 'hidden', 'blocked'].includes(String(source.status))) continue;
    const status = source.status as 'ready' | 'loading' | 'hidden' | 'blocked';
    const lines = readLines({ lines: source.lines }, kind);
    if (kind === 'road') { runtime.roadGeometryStatus = status; runtime.roadLines = status === 'ready' ? lines : null; }
    else { runtime.riverGeometryStatus = status; runtime.riverLines = status === 'ready' ? lines : null; }
  }
}

type Waiter = { receipt: TrackRenderReceipt; done: (result?: TrackRenderHandoffResult) => void; timer: ReturnType<typeof setTimeout> };
type Runtime = {
  client: NativeMapBridgeClient | null;
  mapId: string | null;
  created: boolean;
  hostCreated: boolean;
  viewport: NativeMapViewport | null;
  viewportFingerprint: string;
  viewportAbort: AbortController | null;
  camera: CameraSnapshot | null;
  cameraSync: NativeCameraSync;
  cameraPersistence: NativeCameraPersistence;
  frame: NativeProjectionFrame | null;
  stateRevision: number;
  generation: number;
  props: TerrainMapProps;
  element: HTMLElement | null;
  subscriptions: Array<() => void>;
  projectionListeners: Set<(frame: ProjectionFrame) => void>;
  waiters: Set<Waiter>;
  roadLines: RoadLine[] | null;
  riverLines: RoadLine[] | null;
  roadGeometryStatus: 'ready' | 'loading' | 'hidden' | 'blocked' | null;
  riverGeometryStatus: 'ready' | 'loading' | 'hidden' | 'blocked' | null;
  frameSnapRevision: number | null;
  snapGeometryRevision: number | null;
  pendingSnapGeometry: unknown;
  userInteracting: boolean;
  touchGesture: NativeFollowGesture | null;
  drawingGroundHit: NativeDrawingGroundHit | null;
  previewTrack: TrackOverlay['preview'];
  previewTrackOverride: boolean;
  lastCameraFingerprint: string;
  lastReportedStatus: string;
  readyNotified: boolean;
  projectionSyncScheduler: NativeProjectionSyncScheduler;
  syncAfterProjection?: () => void;
  syncAbort: AbortController | null;
  lastStateFingerprint: string;
  lastAckedPhotoGroupKey: string | null;
  sceneCache?: { tracks: TrackOverlay; preview: TrackOverlay['preview']; guidance: TerrainMapProps['guidanceOverlay']; cues: TerrainMapProps['navigationCues']; route: TerrainMapProps['routeOverlay']; positionCoordinates: Coordinate | null; positionNavigating: TerrainMapProps['positionNavigating']; geometry: ReturnType<typeof createNativeSceneGeometry> };
  mapSourceRef?: MapSource | null;
  preparedMapSource?: (MapSource & { nativeAssetId?: string }) | null;
  preparedMapSourceMapId?: string;
  nativeCadGeometry: FeatureCollection | null;
  interaction: NativeMapInteractionAdapter | null;
  previewSyncTimer: ReturnType<typeof setTimeout> | null;
  transientGeometry: NativeTransientGeometry;
  syncTransientGeometry?: () => void;
  offlineDisplayPolicy: NativeOfflineDisplayPolicyPayload;
  profileNotesPreview: NativeProfileNotesPreview;
};

export const NativeTerrainMap = forwardRef<MapHandle, TerrainMapProps>(function NativeTerrainMap(props, ref) {
  const elementRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = {
    client: null, mapId: null, created: false, hostCreated: false, viewport: null, viewportFingerprint: '', viewportAbort: null,
    camera: null, cameraSync: new NativeCameraSync(), cameraPersistence: new NativeCameraPersistence(
      () => runtimeRef.current?.mapId === 'main' && runtimeRef.current?.props.persistCamera !== false,
      (camera) => {
        const current = runtimeRef.current;
        if (!current || current.mapId !== 'main' || current.props.persistCamera === false) return;
        saveLastView({ center: camera.center, zoom: camera.zoom, pitch: camera.pitch, bearing: camera.bearing, terrain: current.props.settings.terrain });
        if (typeof window !== 'undefined') writeCameraHash(camera);
      },
    ), frame: null, stateRevision: 0, generation: 0, props, element: null, subscriptions: [],
    projectionListeners: new Set(), waiters: new Set(), roadLines: null, riverLines: null, roadGeometryStatus: null, riverGeometryStatus: null,
    frameSnapRevision: null, snapGeometryRevision: null, pendingSnapGeometry: null, nativeCadGeometry: null, interaction: null, previewSyncTimer: null,
    transientGeometry: new NativeTransientGeometry(() => runtimeRef.current?.syncTransientGeometry?.()),
    offlineDisplayPolicy: readNativeOfflineDisplayPolicy(),
    profileNotesPreview: null,
    userInteracting: false, touchGesture: null, drawingGroundHit: null, previewTrack: null, previewTrackOverride: false, lastCameraFingerprint: '', lastReportedStatus: '', readyNotified: false,
    projectionSyncScheduler: new NativeProjectionSyncScheduler(() => runtimeRef.current?.created === true), syncAbort: null, lastStateFingerprint: '', lastAckedPhotoGroupKey: null,
  };
  const runtime = runtimeRef.current;
  runtime.props = props;
  const [mapId, setMapId] = useState<string | null>(null);
  const [isCreated, setIsCreated] = useState(false);

  const report = (message: string, source = false) => {
    if (!message || runtime.lastReportedStatus === message) return;
    runtime.lastReportedStatus = message;
    safeCallback(() => runtime.props.onStatus(message));
    if (source) safeCallback(() => runtime.props.onSourceStatus?.(message));
  };

  const request = (command: string, payload?: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) => {
    const client = runtime.client, id = runtime.mapId;
    if (!client || !id || !client.isReady) {
      report('原生地图桥接尚未就绪');
      return Promise.reject(new NativeMapBridgeError('session-not-ready', '原生地图桥接尚未就绪'));
    }
    return client.request(id, command, payload, options).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : '原生地图请求失败';
      report(`原生地图操作未完成：${message}`);
      throw error;
    });
  };
  const fire = (command: string, payload?: unknown) => { void request(command, payload).catch(() => {}); };

  const setViewport = async (signal?: AbortSignal) => {
    const element = elementRef.current;
    if (!element) return false;
    const next = cssViewport(element);
    runtime.viewport = next;
    const fingerprint = JSON.stringify(next);
    if (!runtime.hostCreated || !runtime.mapId) return false;
    if (fingerprint === runtime.viewportFingerprint) return true;
    runtime.viewportAbort?.abort();
    const controller = new AbortController();
    runtime.viewportAbort = controller;
    if (signal?.aborted) controller.abort();
    try {
      await runtime.client!.setMapViewport(runtime.mapId, next, { signal: controller.signal });
      if (controller.signal.aborted) return false;
      runtime.viewportFingerprint = fingerprint;
      return true;
    } catch (error) {
      if (!controller.signal.aborted) report(`地图视口同步失败：${error instanceof Error ? error.message : '未知错误'}`);
      return false;
    }
  };

  const cameraFromRuntime = () => runtime.camera ?? parseCamera(runtime.frame?.camera) ?? null;

  const cameraOriginToken = (value: unknown): number | null =>
    isRecord(value) && typeof value.cameraSyncToken === 'number' && Number.isSafeInteger(value.cameraSyncToken) && value.cameraSyncToken > 0
      ? value.cameraSyncToken : null;

  const emitCamera = (camera: CameraSnapshot, originToken: number | null, fromUser = runtime.userInteracting) => {
    if (runtime.cameraSync.isStaleProgrammatic(originToken)) return;
    const previous = runtime.camera;
    runtime.camera = camera;
    const programmatic = runtime.cameraSync.isProgrammatic(camera, originToken);
    const fingerprint = JSON.stringify(camera);
    if (fingerprint === runtime.lastCameraFingerprint) return;
    runtime.lastCameraFingerprint = fingerprint;
    const latest = runtime.props;
    if (!programmatic) safeCallback(() => latest.onCameraChange?.(camera));
    const view: ViewState = { bearing: camera.bearing, pitch: camera.pitch, zoom: camera.zoom };
    safeCallback(() => latest.onView(view));
    safeCallback(() => latest.onCenter?.(camera.center));
    if (fromUser && previous) {
      const pitchChanged = Math.abs(camera.pitch - previous.pitch) > 0.01;
      const bearingChanged = Math.abs(((camera.bearing - previous.bearing + 540) % 360) - 180) > 0.01;
      if (pitchChanged || bearingChanged) safeCallback(() => latest.onManualView?.({ pitch: camera.pitch, bearing: camera.bearing }));
      if (bearingChanged) safeCallback(() => latest.onManualRotate());
    }
    runtime.cameraPersistence.update(camera);
  };

  const updateProjection = (rawFrame: NativeProjectionFrame) => {
    if (runtime.cameraSync.isStaleProgrammatic(cameraOriginToken(rawFrame.camera))) return;
    runtime.frame = rawFrame;
    runtime.drawingGroundHit = invalidateNativeDrawingGroundHit(runtime.drawingGroundHit, parseCamera(rawFrame.camera));
    const snapRevision = (rawFrame as NativeProjectionFrame & { snapRevision?: unknown }).snapRevision;
    if (typeof snapRevision === 'number' && Number.isSafeInteger(snapRevision)) {
      runtime.frameSnapRevision = snapRevision;
      if (runtime.snapGeometryRevision !== snapRevision) {
        runtime.roadLines = null; runtime.riverLines = null;
        runtime.roadGeometryStatus = 'loading'; runtime.riverGeometryStatus = 'loading';
      }
      if (runtime.pendingSnapGeometry && isRecord(runtime.pendingSnapGeometry) && runtime.pendingSnapGeometry.cameraRevision === snapRevision) {
        applySnapGeometry(runtime, runtime.pendingSnapGeometry);
        runtime.pendingSnapGeometry = null;
      } else if (isRecord(runtime.pendingSnapGeometry) && typeof runtime.pendingSnapGeometry.cameraRevision === 'number' && runtime.pendingSnapGeometry.cameraRevision < snapRevision) runtime.pendingSnapGeometry = null;
    }
    const camera = parseCamera(rawFrame.camera);
    if (camera) emitCamera(camera, cameraOriginToken(rawFrame.camera));
    const frame: ProjectionFrame = {
      matrix: [...rawFrame.viewProjection],
      width: rawFrame.viewport.width / rawFrame.cssScale,
      height: rawFrame.viewport.height / rawFrame.cssScale,
      longitude: camera?.center[0] ?? runtime.camera?.center[0] ?? 0,
      nativeFrame: localProjectionFrame(rawFrame),
    };
    for (const listener of [...runtime.projectionListeners]) safeCallback(() => listener(frame));
    runtime.syncAfterProjection?.();
    for (const waiter of [...runtime.waiters]) {
      const current = waiter.receipt.trackId === DRAFT_ID
        ? runtime.props.trackOverlay.draft
        : runtime.props.trackOverlay.saved.find((item) => item.id === waiter.receipt.trackId)?.segments;
      if (current === waiter.receipt.segments) finishWaiter(runtime, waiter, 'rendered');
    }
  };

  const notifyReadyIfFrameAvailable = () => {
    if (!shouldNotifyNativeMapReady(runtime.created, runtime.frame, runtime.readyNotified)) return;
    runtime.readyNotified = true;
    safeCallback(() => runtime.props.onReady?.());
  };

  const readRenderState = async (signal: AbortSignal): Promise<NativeMapRenderState & { renderGeometry?: unknown }> => {
    const client = runtime.client!;
    const id = runtime.mapId!;
    const current = runtime.props;
    const source = await prepareMapSource(runtime, client, id, current.mapSource, signal);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const viewport = runtime.viewport ?? {
      cssRect: { x: 0, y: 0, width: 0, height: 0 }, devicePixelRatio: window.devicePixelRatio || 1,
      clientViewportWidth: document.documentElement.clientWidth || window.innerWidth,
    };
    const photoGroups = groupNativePhotos(current.photos, client, id, viewport);
    const photos: NativeMapPhoto[] = await Promise.all(photoGroups.map(async ({ photo, groupIds }) => {
      if (!(photo.preview instanceof Blob)) throw new Error(`照片 ${photo.name || photo.id} 缺少有效预览数据`);
      const previewBase64 = await blobToBase64(photo.preview);
      return serializeNativeMapPhoto(photo, previewBase64, groupIds);
    }));
    const state = {
      revision: ++runtime.stateRevision,
      settings: current.settings,
      mapSource: source,
      routeOverlay: current.routeOverlay,
      guidanceOverlay: current.guidanceOverlay ?? null,
      navigationCues: current.navigationCues ?? null,
      trackOverlay: { ...current.trackOverlay, preview: runtime.previewTrackOverride ? runtime.previewTrack : current.trackOverlay.preview ?? null },
      areaOverlay: current.areaOverlay,
      annotations: current.annotations,
      annotationSelected: current.annotationSelected,
      ...(current.annotationEditingId ? { annotationEditingId: current.annotationEditingId } : {}),
      photos,
      section: current.section,
      sectionItems: current.sectionItems,
      selectedSectionId: current.selectedSectionId,
      sectionEditing: current.sectionEditing,
      sectionCursor: current.sectionCursor,
      position: current.position,
      positionHeading: current.positionHeading,
      positionNavigating: current.positionNavigating,
      interaction: {
        readOnly: current.readOnly ?? false,
        drawingActive: current.drawingActive,
        roadSnapping: current.roadSnapping,
        nodeSnapping: current.nodeSnapping ?? false,
        riverSnapping: current.riverSnapping,
        pickingActive: current.pickingActive,
        annotationPicking: current.annotationPicking ?? false,
        measurementPicking: current.measurementPicking ?? false,
      },
      mapViewport: viewport,
      offlineDisplayPolicy: runtime.offlineDisplayPolicy,
      renderGeometry: { ...sceneGeometry(runtime, current), cad: runtime.nativeCadGeometry, transient: runtime.transientGeometry.snapshot() },
    } as NativeMapRenderState & { renderGeometry?: unknown };
    if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_RENDER_STATE_BYTES) throw new Error('地图状态超过8 MiB桥接上限；数据未截断，原图与原始照片仍保留。');
    return state;
  };

  const syncRenderState = async (signal: AbortSignal): Promise<boolean> => {
    if ((!runtime.created && !runtime.hostCreated) || !runtime.mapId || !runtime.client) return false;
    const generation = runtime.generation, mapId = runtime.mapId, client = runtime.client;
    runtime.syncAbort?.abort();
    const controller = new AbortController();
    runtime.syncAbort = controller;
    const cancel = () => controller.abort();
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', cancel, { once: true });
    try {
      const state = await readRenderState(controller.signal);
      if (controller.signal.aborted || generation !== runtime.generation || (!runtime.created && !runtime.hostCreated)) return false;
      const fingerprint = JSON.stringify({ ...state, revision: 0 });
      const photoGroupKey = nativePhotoGroupKey(state.photos);
      if (fingerprint === runtime.lastStateFingerprint) { runtime.lastAckedPhotoGroupKey = photoGroupKey; return true; }
      const ack = await client.setRenderState(mapId, state, { signal: controller.signal });
      if (controller.signal.aborted || generation !== runtime.generation || mapId !== runtime.mapId || client !== runtime.client) return false;
      if (!ack.applied) throw new Error(ack.reason || '宿主没有应用地图状态');
      runtime.lastStateFingerprint = fingerprint;
      runtime.lastAckedPhotoGroupKey = photoGroupKey;
      return true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || controller.signal.aborted) return false;
      const message = error instanceof Error ? error.message : '地图状态同步失败';
      report(`地图数据未同步：${message}`, true);
      return false;
    } finally { signal.removeEventListener('abort', cancel); if (runtime.syncAbort === controller) runtime.syncAbort = null; }
  };
  runtime.syncAfterProjection = () => {
    runtime.projectionSyncScheduler.scheduleWhenChanged(() => {
      if (!runtime.client || !runtime.mapId || !runtime.viewport) return '';
      return nativePhotoGroupKey(groupNativePhotos(runtime.props.photos, runtime.client, runtime.mapId, runtime.viewport)
        .map(({ photo, groupIds }) => ({ id: photo.id, groupIds })));
    }, () => runtime.lastAckedPhotoGroupKey, () => {
      if (runtime.created) void syncRenderState(new AbortController().signal);
    });
  };
  runtime.syncTransientGeometry = () => {
    runtime.lastStateFingerprint = '';
    if (runtime.created) void syncRenderState(new AbortController().signal);
  };

  const handleHostEvent = (name: string, value: unknown) => {
    if (!isRecord(value) && name !== 'drawingInput') return;
    const latest = runtime.props;
    switch (name) {
      case 'renderFrame':
      case 'cameraFrame':
        if (isNativeFrame(value)) {
          updateProjection(value);
          notifyReadyIfFrameAvailable();
        }
        break;
      case 'camera': {
        const camera = parseCamera(value);
        if (camera) emitCamera(camera, cameraOriginToken(value));
        break;
      }
      case 'status': {
        const message = eventMessage(value);
        if (message) report(message, !!latest.mapSource);
        break;
      }
      case 'mapPick':
      {
        if (latest.readOnly || latest.drawingActive || runtime.interaction?.blocksClick()) break;
        const point = isRecord(value) ? readPoint(value.coordinates ?? value.coordinate) : null;
        if (!point) { report('原生地图返回了无效点位'); break; }
        safeCallback(() => latest.onMapPick(point));
        if (latest.queryOnPick !== false && !latest.readOnly) {
          const elevation = runtime.client?.geometry(runtime.mapId!).elevation(point);
          safeCallback(() => latest.onPoint({ lng: point[0], lat: point[1], elevation: elevation?.status === 'ready' ? elevation.value : null }));
        }
        break;
      }
      case 'tap': {
        if (!isRecord(value) || !isRecord(value.point)) break;
        const rawCoordinate = value.coordinates ?? value.coordinate;
        const coordinateValue = rawCoordinate == null ? null : readPoint(rawCoordinate);
        const x = value.point.x, y = value.point.y;
        if ((rawCoordinate != null && !coordinateValue) || typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
          report('原生地图返回了无效点击点位'); break;
        }
        const pick: NativeTapPick = {
          point: { x, y }, coordinate: coordinateValue,
          ids: Array.isArray(value.ids) ? value.ids.filter((id): id is string => typeof id === 'string') : [],
          ...(typeof value.gestureId === 'string' || typeof value.gestureId === 'number' ? { gestureId: value.gestureId } : {}),
          ...(typeof value.eventTime === 'number' && Number.isFinite(value.eventTime) ? { eventTime: value.eventTime } : {}),
        };
        const photoGroups = runtime.client && runtime.mapId && runtime.viewport
          ? groupNativePhotos(latest.photos, runtime.client, runtime.mapId, runtime.viewport) : [];
        const action = interpretNativeTap(pick, {
          readOnly: latest.readOnly, drawingActive: latest.drawingActive,
          clickBlocked: runtime.interaction?.blocksClick() ?? false,
          queryOnPick: latest.queryOnPick, pickingActive: latest.pickingActive,
          annotationPicking: latest.annotationPicking, measurementPicking: latest.measurementPicking,
          sectionEditing: latest.sectionEditing, sectionEnabled: latest.section.enabled,
          sectionItems: latest.sectionItems, annotations: latest.annotations, photos: latest.photos,
          photoGroups, areaOverlay: latest.areaOverlay, trackOverlay: latest.trackOverlay, routeOverlay: latest.routeOverlay,
        }, (coordinateValue) => runtime.client && runtime.mapId ? pointFromProjection(runtime.client, runtime.mapId, coordinateValue) : null);
        dispatchNativeTapAction(runtime, action);
        break;
      }
      case 'drawingInput': {
        if (isRecord(value)) {
          const point = isRecord(value.point) && Number.isFinite(value.point.x) && Number.isFinite(value.point.y)
            ? { x: value.point.x as number, y: value.point.y as number } : null;
          const groundPoint = isRecord(value.groundPoint) && Number.isFinite(value.groundPoint.x) && Number.isFinite(value.groundPoint.y)
            ? { x: value.groundPoint.x as number, y: value.groundPoint.y as number } : value.groundPoint === null ? null : undefined;
          const coordinateValue = readPoint(value.coordinate);
          const pointerCount = Number.isInteger(value.pointerCount) ? value.pointerCount as number : undefined;
          runtime.drawingGroundHit = updateNativeDrawingGroundHit(runtime.drawingGroundHit, {
            type: typeof value.type === 'string' ? value.type : '', point, groundPoint, coordinate: coordinateValue, pointerCount,
          }, latest.drawingActive && !latest.readOnly, parseCamera(runtime.frame?.camera));
        }
        const input = normalizeDrawingInput(value);
        if (input && !latest.readOnly) safeCallback(() => latest.onDrawingInput(input));
        break;
      }
      case 'touch': {
        if (!isRecord(value)) break;
        const action = Number(value.action);
        if (action === 0) {
          runtime.cameraSync.beginUserGesture();
          runtime.cameraPersistence.beginGesture();
          runtime.userInteracting = true;
          runtime.drawingGroundHit = null;
          const pointers = Array.isArray(value.pointers) ? value.pointers : [];
          const first = isRecord(pointers[0]) ? pointers[0] : null;
          runtime.touchGesture = beginNativeFollowGesture(
            typeof value.gestureId === 'string' || typeof value.gestureId === 'number' ? value.gestureId : null,
            { x: first && typeof first.x === 'number' ? first.x : Number(value.x) || 0, y: first && typeof first.y === 'number' ? first.y : Number(value.y) || 0 },
            Number(value.pointerCount) || 1,
          );
          safeCallback(() => latest.onCameraMoveStart?.());
        } else {
          const count = Number(value.pointerCount) || 1;
          if (count > 1 || action === 3) runtime.drawingGroundHit = null;
          const x = Number(value.x), y = Number(value.y);
          const touchSlop = typeof value.touchSlop === 'number' && Number.isFinite(value.touchSlop) ? value.touchSlop : 8;
          const modeOwnedGesture = !!(latest.drawingActive || runtime.interaction?.blocksClick());
          if (modeOwnedGesture) {
            if (action === 5 || count > 1) {
              runtime.touchGesture = advanceNativeFollowGesture(runtime.touchGesture, action, count, { x: Number(value.x) || 0, y: Number(value.y) || 0 }, touchSlop).gesture;
            }
          } else {
            const transition = advanceNativeFollowGesture(runtime.touchGesture, action, count,
              { x: Number.isFinite(x) ? x : runtime.touchGesture?.start.x ?? 0, y: Number.isFinite(y) ? y : runtime.touchGesture?.start.y ?? 0 }, touchSlop);
            runtime.touchGesture = transition.gesture;
            if (transition.endedFollow) safeCallback(() => latest.onBrowse());
          }
          if (action === 1 || action === 3) {
            runtime.userInteracting = false;
            runtime.cameraPersistence.endGesture();
          }
        }
        break;
      }
      case 'pick':
      case 'objectSelect':
        dispatchObjectSelection(runtime, value, report);
        break;
      case 'sectionStatus':
        if (isRecord(value)) safeCallback(() => latest.onSectionStatus(value as unknown as SectionStatus));
        break;
      case 'modelTerrainStatus':
        if (isRecord(value) && typeof value.message === 'string') safeCallback(() => latest.onModelTerrainStatus(value.message as string));
        break;
      case 'sectionProfile':
        if (isRecord(value)) safeCallback(() => latest.onSectionProfile(value as unknown as SectionProfileData));
        break;
      case 'sectionChange':
        if (isRecord(value)) safeCallback(() => latest.onSectionChange(value as unknown as TerrainMapProps['section']));
        break;
      case 'sectionSelect':
        if (!latest.readOnly && !latest.drawingActive && !latest.pickingActive && !runtime.interaction?.blocksClick() && isRecord(value))
          safeCallback(() => latest.onSectionSelect(typeof value.id === 'string' ? value.id : undefined));
        break;
      case 'satellite':
        if (isSatelliteState(value)) safeCallback(() => latest.onSatellite(value));
        break;
      case 'geology':
        if (isRecord(value)) safeCallback(() => latest.onGeology(value as unknown as GeologyState));
        break;
      case 'roadGeometry': {
        runtime.roadLines = readLines(value, 'road');
        runtime.roadGeometryStatus = runtime.roadLines ? 'ready' : 'blocked';
        break;
      }
      case 'riverGeometry': {
        runtime.riverLines = readLines(value, 'river');
        runtime.riverGeometryStatus = runtime.riverLines ? 'ready' : 'blocked';
        break;
      }
      case 'snapGeometry': {
        if (!isRecord(value) || !Number.isSafeInteger(value.cameraRevision)) break;
        if (runtime.frameSnapRevision === null || (value.cameraRevision as number) > runtime.frameSnapRevision) runtime.pendingSnapGeometry = value;
        else if (value.cameraRevision === runtime.frameSnapRevision) applySnapGeometry(runtime, value);
        else runtime.pendingSnapGeometry = null;
        break;
      }
      case 'capabilityBlocked': {
        const capability = isRecord(value) && typeof value.capability === 'string' ? value.capability : '原生地图功能';
        const reason = isRecord(value) && typeof value.reason === 'string' ? value.reason : '宿主暂未提供此能力';
        report(`${capability}：${reason}`);
        if (capability === 'surveySection') safeCallback(() => latest.onSectionStatus({ phase: 'error', min: 0, max: 0, spacing: 0, samples: 0, valid: 0, tiles: 0, models: 0 }));
        break;
      }
      case 'demCache':
        runtime.syncAfterProjection?.();
        break;
      case 'mapViewport':
      case 'viewCreated':
      case 'mapReady':
      case 'mapIdle':
      case 'renderStateApplied':
      case 'capabilities':
        break;
      default:
        report(`收到未识别的原生地图事件“${name}”，未应用其数据`);
    }
  };

  useEffect(() => {
    const id = leaseMapId(props.className);
    setMapId(id);
    return () => { leasedMapIds.delete(id); };
    // Map identity depends only on the rendered map role, not other props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapId || !elementRef.current) return;
    const element = elementRef.current;
    const generation = ++runtime.generation;
    runtime.lastAckedPhotoGroupKey = null;
    let disposed = false;
    const abort = new AbortController();
    runtime.mapId = mapId;
    runtime.element = element;
    let resizeObserver: ResizeObserver | null = null;
    let renderAbort: AbortController | null = null;
    let cadReadAbort: AbortController | null = null;
    const subscriptions: Array<() => void> = [];
    const ownerGeneration = nextMapOwnerGeneration++;
    const ownerToken = `react-map-${ownerGeneration}-${Math.random().toString(36).slice(2)}`;
    let client: NativeMapBridgeClient | null = null;
    let cacheBridgeInstalled = false;
    let ensureFlight: Promise<void> | null = null;
    let lastEnsureAt = 0;
    let resumeRequested = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const initializationRetry = new NativeInitializationRetry(() => !disposed && !abort.signal.aborted &&
      generation === runtime.generation && !runtime.created && document.visibilityState === 'visible');
    const unsubscribeOfflinePolicy = subscribeNativeOfflineDisplayPolicy((policy) => {
      runtime.offlineDisplayPolicy = policy;
      runtime.lastStateFingerprint = '';
      if (runtime.created) void syncRenderState(new AbortController().signal);
    });
    const refreshProfileNotes = (event?: Event) => {
      const detail = (event as CustomEvent<{ key?: unknown; notes?: unknown }> | undefined)?.detail;
      runtime.profileNotesPreview = detail && typeof detail.key === 'string' && Array.isArray(detail.notes)
        ? { key: detail.key, notes: detail.notes as ProfileNote[] }
        : null;
      runtime.lastStateFingerprint = '';
      if (runtime.created) void syncRenderState(new AbortController().signal);
    };
    const onProfileNotesStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === PROFILE_NOTES_KEY) refreshProfileNotes();
    };
    window.addEventListener(PROFILE_NOTES_CHANGED, refreshProfileNotes);
    window.addEventListener('storage', onProfileNotesStorage);
    const refreshCad = () => {
      cadReadAbort?.abort();
      const controller = new AbortController();
      cadReadAbort = controller;
      void readNativeCadGeometry(controller.signal).then((geometry) => {
        if (disposed || controller.signal.aborted || generation !== runtime.generation) return;
        runtime.nativeCadGeometry = geometry;
        if (runtime.created) void syncRenderState(controller.signal);
      }).catch((error: unknown) => {
        if (!controller.signal.aborted && !disposed) report(`CAD地图图层读取失败：${error instanceof Error ? error.message : '未知错误'}`);
      });
    };
    window.addEventListener(CAD_CHANGED, refreshCad);
    refreshCad();
    const setupClient = async () => {
      if (!client) {
        client = getClient();
        runtime.client = client;
        subscriptions.push(...subscribeNativeProjectionEvents(client, mapId, (name, value) => handleHostEvent(name, value)));
        for (const name of [
          'camera', 'mapReady', 'mapIdle', 'mapPick', 'tap', 'drawingInput',
          'touch', 'pick', 'objectSelect', 'status', 'renderStateApplied', 'sectionStatus', 'sectionProfile', 'sectionChange',
          'sectionSelect', 'modelTerrainStatus', 'satellite', 'geology', 'roadGeometry', 'riverGeometry', 'snapGeometry', 'capabilityBlocked', 'mapViewport', 'viewCreated',
        ]) subscriptions.push(client.subscribe(mapId, name, (value) => handleHostEvent(name, value)));
        runtime.subscriptions = subscriptions;
      }
      await connect(client);
      if (!cacheBridgeInstalled) {
        subscriptions.push(installNativeBrowserCacheBridge(client, mapId));
        cacheBridgeInstalled = true;
      }
    };
    const startInteraction = () => {
      if (!client || runtime.interaction) return;
      const interaction = new NativeMapInteractionAdapter({
        client, mapId,
        enabled: () => runtime.created && !runtime.props.readOnly && !runtime.props.drawingActive && !runtime.props.pickingActive && !runtime.props.sectionEditing,
        resolveTarget: (hit) => resolveNativeDragTarget(runtime, hit),
        occupied: (hit) => isNativeHitOccupied(runtime, hit),
        direct: (target) => target.kind === 'track' && runtime.props.trackOverlay.activeNode?.trackId === target.node.trackId &&
          target.node.coordinate[0] === runtime.props.trackOverlay.activeNode.coordinate[0] && target.node.coordinate[1] === runtime.props.trackOverlay.activeNode.coordinate[1],
        snap: (target, point) => snapNativeTrackNode(runtime, target, point),
        onDragBegin: (target) => safeCallback(() => runtime.props.onDragBegin(target)),
        onDragPreview: (move) => {
          runtime.previewTrack = move?.target.kind === 'track' ? { node: move.target.node, coordinate: move.coordinate } : null;
          runtime.previewTrackOverride = true;
          safeCallback(() => runtime.props.onDragPreview(move));
          safeCallback(() => runtime.props.onTrackPreview?.(runtime.previewTrack));
          if (runtime.previewSyncTimer) clearTimeout(runtime.previewSyncTimer);
          runtime.previewSyncTimer = setTimeout(() => {
            runtime.previewSyncTimer = null;
            if (runtime.created) void syncRenderState(new AbortController().signal);
          }, 50);
        },
        onDragCommit: (move) => safeCallback(() => runtime.props.onDragCommit(move)),
        onMapHold: (hold) => safeCallback(() => runtime.props.onMapHold?.(hold)),
      });
      runtime.interaction = interaction;
      interaction.start();
    };
    const ensureMap = (): Promise<void> => {
      if (disposed || abort.signal.aborted || generation !== runtime.generation || runtime.created || document.visibilityState !== 'visible') return Promise.resolve();
      if (ensureFlight) return ensureFlight;
      const now = Date.now();
      if (lastEnsureAt && now - lastEnsureAt < 500) {
        if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; void ensureMap(); }, 500 - (now - lastEnsureAt));
        return Promise.resolve();
      }
      lastEnsureAt = now;
      let initializationFailed = false;
      let flight: Promise<void>;
      flight = (async () => {
        try {
          await setupClient();
          if (disposed || abort.signal.aborted || generation !== runtime.generation || !client) return;
          await client.createMap(mapId, {
            ownerToken, ownerGeneration,
            persistCamera: runtime.props.persistCamera !== false,
            initialCamera: initialCamera(runtime.props),
            offlineDisplayPolicy: runtime.offlineDisplayPolicy,
          }, { signal: abort.signal });
          if (disposed || abort.signal.aborted || generation !== runtime.generation) {
            await client.disposeMap(mapId, { ownerToken, ownerGeneration }).catch(() => false);
            return;
          }
          runtime.hostCreated = true;
          if (!await setViewport(abort.signal)) throw new Error('地图视口尚未同步');
          renderAbort?.abort();
          renderAbort = new AbortController();
          if (!await syncRenderState(renderAbort.signal)) throw new Error('地图初始状态尚未应用');
          if (disposed || abort.signal.aborted || generation !== runtime.generation) {
            await client.disposeMap(mapId, { ownerToken, ownerGeneration }).catch(() => false);
            return;
          }
          runtime.created = true;
          initializationRetry.reset();
          runtime.syncAfterProjection?.();
          startInteraction();
          setIsCreated(true);
          notifyReadyIfFrameAvailable();
          if (runtime.props.section.enabled && runtime.props.section.survey && client.capability('surveySection').status !== 'ready') {
            report('测量剖面使用了独立的survey renderer，当前原生宿主未提供异步剖面事件；请求未伪装为完成');
          }
        } catch (error) {
          if (!disposed && !abort.signal.aborted && generation === runtime.generation) {
            initializationFailed = true;
            const message = error instanceof Error ? error.message : '原生地图启动失败';
            report(`原生地图初始化失败：${message}`);
          }
        }
      })().finally(() => {
        if (ensureFlight === flight) ensureFlight = null;
        if (resumeRequested && !runtime.created && !disposed && !abort.signal.aborted && document.visibilityState === 'visible') {
          resumeRequested = false;
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { retryTimer = null; void ensureMap(); }, 510);
        } else if (initializationFailed) {
          initializationRetry.schedule(() => { void ensureMap(); });
        }
      });
      ensureFlight = flight;
      return flight;
    };
    const retryOnForeground = () => {
      if (document.visibilityState !== 'visible' || disposed || abort.signal.aborted) return;
      initializationRetry.reset();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (!runtime.created) {
        if (ensureFlight) resumeRequested = true;
        else void ensureMap();
      }
      else void setViewport(abort.signal);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retryOnForeground();
      else {
        initializationRetry.cancel();
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        resumeRequested = false;
      }
    };
    window.addEventListener('shantu:native-map-resume', retryOnForeground);
    window.addEventListener('focus', retryOnForeground);
    document.addEventListener('visibilitychange', onVisibility);
    void ensureMap();
    const publishViewport = () => { void setViewport(abort.signal); };
    resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publishViewport);
    resizeObserver?.observe(element);
    window.addEventListener('resize', publishViewport, { passive: true });
    window.addEventListener('scroll', publishViewport, { passive: true, capture: true });
    window.visualViewport?.addEventListener('resize', publishViewport, { passive: true });
    window.visualViewport?.addEventListener('scroll', publishViewport, { passive: true });
    return () => {
      disposed = true;
      abort.abort();
      runtime.cameraPersistence.flush();
      initializationRetry.cancel();
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      renderAbort?.abort();
      cadReadAbort?.abort();
      runtime.interaction?.dispose();
      runtime.interaction = null;
      if (runtime.previewSyncTimer) clearTimeout(runtime.previewSyncTimer);
      runtime.previewSyncTimer = null;
      window.removeEventListener(CAD_CHANGED, refreshCad);
      window.removeEventListener(PROFILE_NOTES_CHANGED, refreshProfileNotes);
      window.removeEventListener('storage', onProfileNotesStorage);
      runtime.profileNotesPreview = null;
      unsubscribeOfflinePolicy();
      runtime.viewportAbort?.abort();
      runtime.syncAbort?.abort();
      runtime.projectionSyncScheduler.cancel();
      runtime.syncAfterProjection = undefined;
      runtime.syncTransientGeometry = undefined;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', publishViewport);
      window.removeEventListener('scroll', publishViewport, true);
      window.visualViewport?.removeEventListener('resize', publishViewport);
      window.visualViewport?.removeEventListener('scroll', publishViewport);
      subscriptions.forEach((unsubscribe) => unsubscribe());
      runtime.subscriptions = [];
      for (const waiter of [...runtime.waiters]) finishWaiter(runtime, waiter, 'cancelled');
      runtime.projectionListeners.clear();
      runtime.userInteracting = false;
      runtime.touchGesture = null;
      runtime.frame = null;
      runtime.camera = null;
      runtime.nativeCadGeometry = null;
      runtime.transientGeometry.clear();
      runtime.created = false;
      runtime.hostCreated = false;
      runtime.readyNotified = false;
      runtime.lastStateFingerprint = '';
      runtime.lastAckedPhotoGroupKey = null;
      setIsCreated(false);
      window.removeEventListener('shantu:native-map-resume', retryOnForeground);
      window.removeEventListener('focus', retryOnForeground);
      document.removeEventListener('visibilitychange', onVisibility);
      if (runtime.client && runtime.mapId) void runtime.client.disposeMap(runtime.mapId, { ownerToken, ownerGeneration }).catch((error: unknown) => report(`释放原生地图失败：${error instanceof Error ? error.message : '未知错误'}`));
      runtime.mapId = null;
      runtime.element = null;
    };
  }, [mapId]);

  useEffect(() => {
    if (!isCreated) return;
    const controller = new AbortController();
    void syncRenderState(controller.signal);
    return () => controller.abort();
  }, [
    isCreated,
    props.settings, props.mapSource, props.routeOverlay, props.guidanceOverlay, props.navigationCues,
    props.trackOverlay, props.areaOverlay, props.annotations, props.annotationSelected, props.annotationEditingId,
    props.photos, props.section, props.sectionItems, props.selectedSectionId, props.sectionEditing, props.sectionCursor,
    props.position, props.positionHeading, props.positionNavigating, props.readOnly, props.drawingActive,
    props.roadSnapping, props.nodeSnapping, props.riverSnapping, props.pickingActive,
    props.annotationPicking, props.measurementPicking,
  ]);

  useImperativeHandle(ref, () => makeHandle(runtime, report, request), []);

  return <div ref={elementRef} className={`map-canvas${props.className ? ` ${props.className}` : ''}`} data-native-map-id={mapId ?? undefined} data-native-map-ready={isCreated ? 'true' : 'false'}>
    {isCreated && mapId && runtime.client && props.onAnnotationNavigate && !props.readOnly
      ? <NativeAnnotationNavigation client={runtime.client} mapId={mapId} annotations={props.annotations}
          selectedId={props.annotationSelected} onNavigate={(id, slot) => props.onAnnotationNavigate?.(id, slot)} />
      : null}
  </div>;
});

function isNativeFrame(value: unknown): value is NativeProjectionFrame {
  if (!isRecord(value) || !isRecord(value.viewport) || !isRecord(value.camera)) return false;
  return Number.isSafeInteger(value.sequence) && Array.isArray(value.viewProjection) && value.viewProjection.length === 16 &&
    Array.isArray(value.inverseViewProjection) && value.inverseViewProjection.length === 16 &&
    [value.viewport.x, value.viewport.y, value.viewport.width, value.viewport.height, value.cssScale, value.demRevision].every((n) => typeof n === 'number' && Number.isFinite(n));
}

function isSatelliteState(value: unknown): value is SatelliteState {
  return isRecord(value) && typeof value.date === 'string' && typeof value.status === 'string' && typeof value.ready === 'boolean';
}

function normalizeDrawingInput(value: unknown): DrawingInput | null {
  if (!isRecord(value)) return null;
  if (value.type === 'cancel') return { type: 'cancel' };
  if (value.type === 'end' && ['release', 'navigation', 'interrupt'].includes(String(value.reason))) return { type: 'end', reason: value.reason as 'release' | 'navigation' | 'interrupt' };
  if ((value.type === 'start' || value.type === 'move') && isRecord(value.point) && Number.isFinite(value.point.x) && Number.isFinite(value.point.y)) {
    return { type: value.type, point: { x: value.point.x as number, y: value.point.y as number } };
  }
  return null;
}

function finishWaiter(runtime: Runtime, waiter: Waiter, result: TrackRenderHandoffResult) {
  if (!runtime.waiters.delete(waiter)) return;
  clearTimeout(waiter.timer);
  safeCallback(() => waiter.done(result));
}

function dispatchNativeTapAction(runtime: Runtime, action: ReturnType<typeof interpretNativeTap>) {
  const current = runtime.props;
  switch (action.type) {
    case 'none': return;
    case 'mapPick': {
      if (action.queryPoint && current.queryOnPick !== false) {
        const elevation = runtime.client && runtime.mapId ? runtime.client.geometry(runtime.mapId).elevation(action.coordinate) : null;
        safeCallback(() => current.onPoint({ lng: action.coordinate[0], lat: action.coordinate[1], elevation: elevation?.status === 'ready' ? elevation.value : null }));
      }
      safeCallback(() => current.onMapPick(action.coordinate));
      return;
    }
    case 'annotation': safeCallback(() => current.onAnnotationSelect(action.id)); return;
    case 'annotationNavigate': safeCallback(() => current.onAnnotationNavigate?.(action.id, action.slot)); return;
    case 'photo': safeCallback(() => current.onPhotoSelect(action.ids)); return;
    case 'area': safeCallback(() => current.onAreaSelect(action.id)); return;
    case 'track': safeCallback(() => current.onTrackSelect(action.id)); return;
    case 'trackNode': safeCallback(() => current.onTrackNodeSelect(action.node)); return;
    case 'trackLine': safeCallback(() => current.onTrackLineSelect(action.point)); return;
    case 'route': safeCallback(() => current.onRouteSelect?.()); return;
    case 'section': safeCallback(() => current.onSectionSelect(action.id)); return;
  }
}

function dispatchObjectSelection(runtime: Runtime, value: unknown, report: (message: string) => void) {
  const current = runtime.props;
  if (current.readOnly || current.drawingActive || runtime.interaction?.blocksClick()) return;
  const record = isRecord(value) ? value : {};
  if (record.selection && isRecord(record.selection)) return dispatchObjectSelection(runtime, record.selection, report);
  const kind = typeof record.kind === 'string' ? record.kind : '';
  const id = typeof record.id === 'string' ? record.id : '';
  const trackNode = isRecord(record.node) ? record.node : null;
  const linePoint = isRecord(record.linePoint) ? record.linePoint : null;
  const move = isRecord(record.move) ? record.move as unknown as FeatureMove : null;
  const phase = record.phase;
  if (current.annotationPicking && !['annotation', 'pin', 'model', 'annotationNavigate'].includes(kind)) return;
  if (current.measurementPicking) {
    if ((kind === 'trackNode' || kind === 'trackLine') && readPoint(record.coordinate)) safeCallback(() => current.onMapPick(readPoint(record.coordinate)!));
    return;
  }
  if (current.pickingActive) return;
  if (current.sectionEditing && kind !== 'annotation' && kind !== 'pin' && kind !== 'model' && kind !== 'section') return;
  if (kind === 'section') {
    if (id === '__active') safeCallback(() => current.onSectionSelect());
    else if (id && current.sectionItems.some((item) => item.id === id && item.settings.enabled)) safeCallback(() => current.onSectionSelect(id));
    return;
  }
  if (kind === 'annotation' || kind === 'pin' || kind === 'model') { if (id) safeCallback(() => current.onAnnotationSelect(id)); return; }
  const slot = record.slot;
  if (kind === 'annotationNavigate' && id && (slot === 'start' || slot === 'end')) { safeCallback(() => current.onAnnotationNavigate?.(id, slot)); return; }
  if (kind === 'photo') {
    const groupIds = Array.isArray(record.groupIds) ? record.groupIds.filter((value): value is string => typeof value === 'string') : [];
    const ids = groupIds.length ? groupIds : (id ? [id] : []);
    if (ids.length) safeCallback(() => current.onPhotoSelect(ids));
    return;
  }
  if (kind === 'area') { if (id) safeCallback(() => current.onAreaSelect(id)); return; }
  if (kind === 'route') { safeCallback(() => current.onRouteSelect?.()); return; }
  const selectedTrackId = typeof record.trackId === 'string' ? record.trackId : id;
  if (kind === 'track' && selectedTrackId) {
    if (current.trackOverlay.editing && runtime.client && runtime.mapId) {
      const pickedCoordinate = readPoint(record.coordinate);
      const point = pickedCoordinate ? pointFromProjection(runtime.client, runtime.mapId, pickedCoordinate) : null;
      const segments = selectedTrackId === DRAFT_ID
        ? current.trackOverlay.draft
        : current.trackOverlay.saved.find((track) => track.id === selectedTrackId)?.segments;
      const linePoint = point && segments ? pickLinePoint(selectedTrackId, segments, point,
        (coordinateValue) => pointFromProjection(runtime.client!, runtime.mapId!, coordinateValue) ?? { x: Number.NaN, y: Number.NaN }) : null;
      if (linePoint) { safeCallback(() => current.onTrackLineSelect(linePoint)); return; }
    }
    safeCallback(() => current.onTrackSelect(selectedTrackId)); return;
  }
  const flatTrackNode = kind === 'trackNode' && typeof record.trackId === 'string' && readPoint(record.coordinate)
    ? { trackId: record.trackId, coordinate: readPoint(record.coordinate)! }
    : trackNode;
  if (kind === 'trackNode' && flatTrackNode && typeof flatTrackNode.trackId === 'string' && readPoint(flatTrackNode.coordinate)) {
    safeCallback(() => current.onTrackNodeSelect(flatTrackNode as unknown as TrackNode)); return;
  }
  if (kind === 'trackLine' && linePoint && typeof linePoint.trackId === 'string' && readPoint(linePoint.coordinate) && typeof linePoint.distance === 'number') {
    safeCallback(() => current.onTrackLineSelect(linePoint as unknown as TrackLinePoint)); return;
  }
  if (kind === 'dragBegin' && record.target) { safeCallback(() => current.onDragBegin(record.target as unknown as DragTarget)); return; }
  if (kind === 'dragPreview') { safeCallback(() => current.onDragPreview(move)); return; }
  if (kind === 'dragCommit' && move) { safeCallback(() => current.onDragCommit(move)); return; }
  const ids = Array.isArray(record.ids) ? record.ids.filter((item): item is string => typeof item === 'string') : [];
  const bridged = ids.find((value) => value.startsWith('shantu-bridge:'));
  if (bridged) {
    try {
      const metadata: unknown = JSON.parse(bridged.slice('shantu-bridge:'.length));
      if (isRecord(metadata)) {
        return dispatchObjectSelection(runtime, { ...metadata, coordinate: metadata.coordinate ?? record.coordinate }, report);
      }
      report('原生地图返回了无法解释的业务拾取对象');
    } catch { report('原生地图拾取元数据格式无效'); }
    return;
  }
  if (ids.length === 1) {
    const picked = ids[0]!;
    const annotation = current.annotations.find((item) => item.id === picked || picked === `shantu-object:${item.id}` || picked === `annotation:${item.id}`);
    if (annotation) { safeCallback(() => current.onAnnotationSelect(annotation.id)); return; }
    if (current.areaOverlay.items.some((item) => item.id === picked)) { safeCallback(() => current.onAreaSelect(picked)); return; }
    if (current.trackOverlay.saved.some((item) => item.id === picked || picked.startsWith(`track:${item.id}:`))) {
      const track = current.trackOverlay.saved.find((item) => item.id === picked || picked.startsWith(`track:${item.id}:`));
      if (track) { safeCallback(() => current.onTrackSelect(track.id)); return; }
    }
    if (current.photos.some((photo) => photo.id === picked || picked === `photo:${photo.id}`)) {
      const photo = current.photos.find((item) => item.id === picked || picked === `photo:${item.id}`)!;
      safeCallback(() => current.onPhotoSelect([photo.id])); return;
    }
    if (picked === '__planned-route' || picked.startsWith('__route-display-') || picked.startsWith('route:')) { safeCallback(() => current.onRouteSelect?.()); return; }
  }
  if (ids.length) report(`原生拾取返回了未识别对象类型：${ids.join(', ')}`);
}

function nativePickMetadata(ids: string[]): AnyRecord[] {
  const output: AnyRecord[] = [];
  for (const id of ids) {
    if (!id.startsWith('shantu-bridge:')) continue;
    try { const value: unknown = JSON.parse(id.slice('shantu-bridge:'.length)); if (isRecord(value)) output.push(value); } catch { /* malformed native IDs are ignored */ }
  }
  return output;
}

function resolveNativeDragTarget(runtime: Runtime, hit: NativeHitTest): DragTarget | null {
  const current = runtime.props;
  const metadata = nativePickMetadata(hit.ids);
  if (current.trackOverlay.editing && !current.drawingActive && current.trackOverlay.movableTrackId) {
    const nodeHit = metadata.find((item) => item.kind === 'trackNode' && item.trackId === current.trackOverlay.movableTrackId);
    const coordinateValue = readPoint(nodeHit?.coordinate);
    if (nodeHit && coordinateValue) {
      const trackId = String(nodeHit.trackId);
      const segments = trackId === DRAFT_ID ? current.trackOverlay.draft : current.trackOverlay.saved.find((item) => item.id === trackId)?.segments;
      if (!segments) return null;
      const track = current.trackOverlay.saved.find((item) => item.id === trackId);
      const controls = [...(track?.nodes ?? []), ...current.trackOverlay.nodes];
      const controlMove = prepareVisibleNodeMove(segments, coordinateValue, controls);
      return { kind: 'track', node: { trackId, coordinate: coordinateValue, ...(controlMove ? { controlMove } : {}) } };
    }
    return null;
  }
  const objectIds = hit.ids.filter((id) => id.startsWith('shantu-object:')).map((id) => id.slice('shantu-object:'.length));
  const annotation = current.annotations.find((item) => objectIds.includes(item.id) && item.visible && item.kind === 'pin' && !item.trackAnchor && !item.sectionAnchor);
  if (annotation) {
    if (current.annotationEditingId && current.annotationEditingId !== annotation.id) return null;
    return { kind: 'annotation', id: annotation.id, coordinate: annotation.coordinates };
  }
  if (current.areaOverlay.selected) {
    const areaId = current.areaOverlay.selected;
    const area = current.areaOverlay.items.find((item) => item.id === areaId && item.visible);
    const point = hit.coordinate ? pointFromProjection(runtime.client!, runtime.mapId!, hit.coordinate) : null;
    if (area && point && objectIds.includes(areaId)) {
      let nearest: { index: number; distance: number; coordinate: Coordinate } | null = null;
      for (let index = 0; index < area.boundary.length; index++) {
        const coordinateValue = area.boundary[index]!;
        const projected = pointFromProjection(runtime.client!, runtime.mapId!, coordinateValue);
        if (!projected) continue;
        const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
        if (distance <= 14 && (!nearest || distance < nearest.distance)) nearest = { index, distance, coordinate: coordinateValue };
      }
      if (nearest) return { kind: 'area', id: areaId, index: nearest.index, coordinate: nearest.coordinate };
    }
  }
  return null;
}

function isNativeHitOccupied(runtime: Runtime, hit: NativeHitTest): boolean {
  if (nativePickMetadata(hit.ids).some((item) => item.kind === 'track' || item.kind === 'trackNode')) return true;
  const ids = hit.ids.filter((id) => id.startsWith('shantu-object:')).map((id) => id.slice('shantu-object:'.length));
  return runtime.props.annotations.some((item) => item.visible && ids.includes(item.id));
}

function snapNativeTrackNode(runtime: Runtime, target: DragTarget, point: ScreenPoint): TrackNode | null {
  const current = runtime.props;
  if (target.kind !== 'track' || !current.nodeSnapping || !current.trackOverlay.editing || !runtime.client || !runtime.mapId) return null;
  if (!current.trackOverlay.visible) return null;
  let nearest: { node: TrackNode; distance: number } | null = null;
  for (const track of current.trackOverlay.saved) {
    if (track.hidden || track.source === 'recorded' || track.samples !== undefined) continue;
    if (track.id !== current.trackOverlay.selectedId && !current.trackOverlay.connecting && !current.trackOverlay.snapTargets) continue;
    const positions = track.nodes?.length ? track.nodes : track.segments.flat();
    for (const coordinateValue of positions) {
      if (track.id === target.node.trackId && coordinateValue[0] === target.node.coordinate[0] && coordinateValue[1] === target.node.coordinate[1]) continue;
      const projected = pointFromProjection(runtime.client, runtime.mapId, coordinateValue);
      if (!projected) continue;
      const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
      if (distance <= 14 && (!nearest || distance < nearest.distance)) nearest = { node: { trackId: track.id, coordinate: coordinateValue }, distance };
    }
  }
  return nearest?.node ?? null;
}

function makeHandle(
  runtime: Runtime,
  report: (message: string, source?: boolean) => void,
  request: (command: string, payload?: unknown, options?: { signal?: AbortSignal; timeoutMs?: number }) => Promise<unknown>,
): MapHandle {
  const fire = (command: string, payload?: unknown) => { void request(command, payload).catch(() => {}); };
  const projection = (point: Coordinate) => runtime.client && runtime.mapId ? pointFromProjection(runtime.client, runtime.mapId, point) : null;
  const geometryCoordinate = (point: ScreenPoint) => runtime.client && runtime.mapId ? fromLocalScreen(runtime.client, runtime.mapId, point) : null;
  const roadSnapper = (kind: 'road' | 'river'): RoadSnapper => (point, previous, from) => {
    const enabled = kind === 'road' ? runtime.props.settings.roads : runtime.props.riverSnapping;
    if (!enabled) return { status: 'hidden', match: null };
    const geometryStatus = kind === 'road' ? runtime.roadGeometryStatus : runtime.riverGeometryStatus;
    if (geometryStatus === 'hidden') return { status: 'hidden', match: null };
    if (!geometryStatus || geometryStatus === 'loading') return { status: 'loading', match: null };
    if (geometryStatus === 'blocked') return { status: 'unavailable', match: null };
    const lines = kind === 'road' ? runtime.roadLines : runtime.riverLines;
    if (!lines) return { status: 'unavailable', match: null };
    if (!runtime.client || !runtime.mapId) return { status: 'unavailable', match: null };
    const project = (coordinateValue: Coordinate) => projection(coordinateValue);
    const match = nearestRoad(point, lines, project, previous);
    let section: Coordinate[] | null | undefined;
    if (from && match) {
      const screen = project(from);
      const start = screen ? nearestRoad(screen, lines, project) : null;
      section = start ? roadPath(start, match, lines) : null;
    }
    return { status: match || lines.length ? 'ready' : 'unavailable', match, section };
  };
  const handle: MapHandle = {
    isUserInteracting: () => runtime.userInteracting,
    pickTrackContinuation: (point): TrackContinuationHit | null => {
      if (!runtime.client || !runtime.mapId || !runtime.props.trackOverlay.visible) return null;
      return pickTrackContinuation(
        runtime.props.trackOverlay.saved.filter((track) => !track.hidden && track.id !== DRAFT_ID && track.id !== 'live-recording'),
        point,
        (coordinateValue) => projection(coordinateValue) ?? { x: Number.NaN, y: Number.NaN },
        { draftEmpty: runtime.props.trackOverlay.draft.every((segment) => segment.length === 0) },
      );
    },
    waitForTrackRender: (receipt, done) => {
      const waiter: Waiter = { receipt, done, timer: setTimeout(() => finishWaiter(runtime, waiter, 'timeout'), 2000) };
      runtime.waiters.add(waiter);
      return () => finishWaiter(runtime, waiter, 'cancelled');
    },
    applyCamera: (camera) => {
      if (runtime.userInteracting) return;
      const cameraSyncToken = runtime.cameraSync.apply(camera, runtime.camera);
      fire('applyCamera', { ...camera, cameraSyncToken });
    },
    previewTrackNode: (preview) => {
      runtime.previewTrack = preview;
      runtime.previewTrackOverride = true;
      const controller = new AbortController();
      void (async () => {
        try {
          const state = await buildCurrentState(runtime, controller.signal);
          await runtime.client?.setRenderState(runtime.mapId!, state, { signal: controller.signal });
        } catch (error) { if (!controller.signal.aborted) report(`路线节点预览失败：${error instanceof Error ? error.message : '未知错误'}`); }
      })();
    },
    shareMapStyle: (): ShareMapStyle | null => runtime.created && runtime.client && runtime.mapId
      ? createNativeShareStyle(runtime.client, runtime.mapId, (signal) => buildCurrentState(runtime, signal))
      : null,
    highlightOffline: (trip: TripPackage) => {
      runtime.transientGeometry.offlineCoverage(trip, 3000);
      runtime.syncTransientGeometry?.();
    },
    cameraSnapshot: () => runtime.camera ?? null,
    restoreCamera: (camera) => { fire('restoreCamera', camera); },
    setTerrainMode: (terrain) => { fire('setTerrainMode', { enabled: terrain }); },
    syncCameraHash: () => { if (runtime.props.persistCamera !== false && runtime.mapId === 'main' && runtime.camera) writeCameraHash(runtime.camera); },
    groundElevation: (coordinates) => {
      if (!runtime.client || !runtime.mapId) return null;
      const result = runtime.client.geometry(runtime.mapId).elevation(coordinates);
      return result.status === 'ready' ? result.value : null;
    },
    centerCoordinate: () => {
      const viewport = runtime.viewport?.cssRect;
      return viewport ? geometryCoordinate({ x: viewport.width / 2, y: viewport.height / 2 }) : null;
    },
    offlineRegionBounds: (visible = false) => {
      const camera = runtime.camera, rect = runtime.viewport?.cssRect;
      if (!camera || !rect) return null;
      if (!visible && (Math.abs(camera.pitch) > 0.1 || Math.abs(camera.bearing) > 0.1)) throw new Error('请切回正北2D视图后选择范围');
      const inset = visible ? 0 : undefined;
      const a = visible ? { x: 0, y: 0 } : { x: 16, y: 96 };
      const b = visible ? { x: rect.width, y: rect.height } : { x: Math.max(0, rect.width - 76), y: Math.max(0, rect.height - 180) };
      const points = [geometryCoordinate(a), geometryCoordinate({ x: b.x, y: a.y }), geometryCoordinate(b), geometryCoordinate({ x: a.x, y: b.y })];
      if (points.some((point) => !point)) return null;
      const valid = points as Coordinate[];
      return [Math.min(...valid.map((point) => point[0])), Math.min(...valid.map((point) => point[1])), Math.max(...valid.map((point) => point[0])), Math.max(...valid.map((point) => point[1]))];
    },
    watchObjectProjection: (listener) => {
      runtime.projectionListeners.add(listener);
      if (runtime.frame) {
        const frame = runtime.frame;
        listener({ matrix: [...frame.viewProjection], width: frame.viewport.width / frame.cssScale, height: frame.viewport.height / frame.cssScale, longitude: runtime.camera?.center[0] ?? frame.camera.center[0], nativeFrame: localProjectionFrame(frame) });
      }
      return () => { runtime.projectionListeners.delete(listener); };
    },
    sectionCenter: () => {
      const camera = runtime.camera, viewport = runtime.viewport?.cssRect;
      if (!camera || !viewport) return null;
      const elevation = runtime.client && runtime.mapId ? runtime.client.geometry(runtime.mapId).elevation(camera.center) : null;
      const fallback = runtime.props.annotations.find((item) => item.visible && item.groundElevation !== null)?.groundElevation;
      const altitude = elevation?.status === 'ready' ? elevation.value : fallback;
      if (altitude === null || altitude === undefined) return null;
      const metersPerPixel = (40075016.68557849 * Math.cos((camera.center[1] * Math.PI) / 180)) / (512 * 2 ** camera.zoom);
      return { center: camera.center, altitude: Math.round(altitude), width: Math.max(100, Math.min(200000, metersPerPixel * viewport.width * 0.6)), heading: camera.bearing };
    },
    refreshSection: () => { fire('refreshSection', {}); },
    snapRoad: roadSnapper('road'),
    snapRiver: roadSnapper('river'),
    zoom: (amount) => { fire('zoom', { amount }); },
    north: () => { fire('north', {}); },
    reset: () => {
      runtime.props.onBrowse();
      const initial = INITIAL_VIEW;
      fire('restoreCamera', { center: initial.center, zoom: initial.zoom, pitch: initial.pitch, bearing: initial.bearing, duration: 700 });
    },
    view: (pitch, bearing, animate = true) => {
      fire('applyCamera', nativeViewCamera(runtime.camera ?? INITIAL_VIEW, pitch, bearing, animate));
    },
    viewGesture: (pitch, bearing, phase) => {
      fire('viewGesture', { ...nativeViewCamera(runtime.camera ?? INITIAL_VIEW, pitch, bearing, false), phase });
    },
    refreshSatellite: () => {
      void request('refreshSatellite', {}).catch(() => {
        safeCallback(() => runtime.props.onSatellite({ date: '', ready: false, status: '原生地图宿主未提供卫星影像日期刷新能力' }));
      });
    },
    refreshGeology: () => {
      void request('refreshGeology', {}).catch(() => {
        safeCallback(() => runtime.props.onGeology({ ...INITIAL_GEOLOGY, source: 'geocloud20w', status: 'error', message: '原生地图宿主未提供地质图层刷新能力' }));
      });
    },
    inspect: () => {
      const frame = runtime.frame;
      return {
        ready: !!runtime.created && !!frame,
        mapId: runtime.mapId,
        camera: runtime.camera,
        viewport: runtime.viewport,
        frameSequence: frame?.sequence ?? null,
        demRevision: frame?.demRevision ?? null,
        geometry: runtime.client && runtime.mapId ? runtime.client.geometry(runtime.mapId).elevation(runtime.camera?.center ?? [0, 0]) : { status: 'blocked', reason: 'map-not-created' },
        capabilities: runtime.client ? Object.fromEntries(['projection', 'elevation', 'pick', 'photos', 'roadSnapping', 'riverSnapping', 'offlineRegionBounds', 'mapStyleShare', 'magnify'].map((name) => [name, runtime.client!.capability(name)])) : {},
      };
    },
    focusPoint: (coordinates, zoom) => {
      runtime.props.onBrowse();
      fire('applyCamera', nativeFocusCamera(runtime.camera ?? INITIAL_VIEW, coordinates, zoom));
    },
    focusCenter: (coordinates) => { fire('applyCamera', nativeFocusCamera(runtime.camera ?? INITIAL_VIEW, coordinates)); },
    focusRouteGap: (gap: RouteGap) => {
      runtime.props.onBrowse();
      runtime.transientGeometry.routeGap(gap);
      runtime.syncTransientGeometry?.();
      const viewport = runtime.viewport?.cssRect;
      fire('applyCamera', nativeRouteGapCamera(runtime.camera ?? INITIAL_VIEW, gap, viewport?.width ?? 0, viewport?.height ?? 0));
    },
    clearRouteGap: () => { runtime.transientGeometry.routeGap(null); runtime.syncTransientGeometry?.(); },
    focusRouteIssue: (point, kind) => {
      runtime.props.onBrowse();
      runtime.transientGeometry.routeGap(null);
      runtime.transientGeometry.routeIssue(point, kind);
      runtime.syncTransientGeometry?.();
      fire('applyCamera', nativeRouteIssueCamera(point));
    },
    clearRouteIssue: () => { runtime.transientGeometry.routeIssue(null); runtime.syncTransientGeometry?.(); },
    focusPosition: (coordinates, zoom, pitch) => {
      if (!runtime.created) return false;
      fire('applyCamera', nativeFocusPositionCamera(runtime.camera ?? INITIAL_VIEW, coordinates, zoom, pitch));
      return true;
    },
    fitRoute: (coordinates) => { runtime.props.onBrowse(); fire('fitRoute', { coordinates }); },
    fitCollection: (coordinates, padding) => { fire('fitCollection', { coordinates, ...(padding ? { padding } : {}) }); },
    previewRoute: (coordinateValue) => {
      runtime.transientGeometry.previewRoute(coordinateValue);
      runtime.syncTransientGeometry?.();
      if (!coordinateValue) return;
      runtime.props.onBrowse();
      const camera = nativeFocusCamera(runtime.camera ?? INITIAL_VIEW, coordinateValue);
      fire('applyCamera', { ...camera, duration: 0 });
    },
    followPosition: (coordinates, animate = true) => {
      if (!runtime.created) return false;
      fire('followPosition', { coordinate: coordinates, animate });
      return true;
    },
    followNavigation: (coordinates, options: NavigationCameraRequest) => {
      if (!runtime.created) return false;
      const { height, usableRect } = navigationUsableRect(runtime);
      fire('applyCamera', nativeNavigationCamera(runtime.camera ?? INITIAL_VIEW, options, coordinates, height, usableRect));
      return true;
    },
    previewNavigation: (coordinates, path, forward, zoom) => {
      if (!runtime.created) return false;
      runtime.props.onBrowse();
      const { height, usableRect } = navigationUsableRect(runtime);
      fire('applyCamera', nativePreviewNavigationCamera(runtime.camera ?? INITIAL_VIEW, coordinates, path, forward, height, zoom, usableRect));
      return true;
    },
    toCoordinate: (point) => nativeDrawingCoordinateAt(runtime.drawingGroundHit, point, runtime.props.drawingActive && !runtime.props.readOnly, parseCamera(runtime.frame?.camera)) ?? geometryCoordinate(point),
    stop: () => { fire('stop', {}); },
    toScreen: (coordinateValue) => projection(coordinateValue),
    getSnapViewport: (): SnapViewport | null => {
      const rect = runtime.viewport?.cssRect;
      if (!rect) return null;
      const corners = [
        { x: 14, y: 14 }, { x: Math.max(14, rect.width - 14), y: 14 },
        { x: Math.max(14, rect.width - 14), y: Math.max(14, rect.height - 14) }, { x: 14, y: Math.max(14, rect.height - 14) },
      ].map(geometryCoordinate);
      if (corners.some((point) => !point)) return null;
      const valid = corners as Coordinate[];
      return { west: Math.min(...valid.map((p) => p[0])), east: Math.max(...valid.map((p) => p[0])), south: Math.min(...valid.map((p) => p[1])), north: Math.max(...valid.map((p) => p[1])), width: rect.width, height: rect.height, revision: runtime.frame?.sequence };
    },
    magnify: (target, point) => magnify(runtime, target, point, report),
    panZoomGesture: (previous, next) => {
      if (!runtime.client || !runtime.mapId || previous.length < 2 || next.length < 2) return;
      const from = { x: (previous[0]!.x + previous[1]!.x) / 2, y: (previous[0]!.y + previous[1]!.y) / 2 };
      const anchorCoordinate = fromLocalScreen(runtime.client, runtime.mapId, from);
      if (!anchorCoordinate) return;
      const result = nativeAnchoredGesture(runtime.camera ?? INITIAL_VIEW, [previous[0]!, previous[1]!], [next[0]!, next[1]!], anchorCoordinate);
      fire('panZoomGesture', { ...result, phase: 'move' });
    },
    finishPanZoomGesture: () => { fire('finishPanZoomGesture', {}); },
  };
  return handle;
}

async function buildCurrentState(runtime: Runtime, signal: AbortSignal): Promise<NativeMapRenderState> {
  const client = runtime.client!, mapId = runtime.mapId!;
  const current = runtime.props;
  const mapSource = await prepareMapSource(runtime, client, mapId, current.mapSource, signal);
  const viewport = runtime.viewport ?? { cssRect: { x: 0, y: 0, width: 0, height: 0 }, devicePixelRatio: window.devicePixelRatio || 1, clientViewportWidth: document.documentElement.clientWidth || window.innerWidth };
  const photoGroups = groupNativePhotos(current.photos, client, mapId, viewport);
  const profileNotesRaw = readNativeProfileNotesRaw();
  const sectionWithNotes = (settings: TerrainMapProps['section']) => sectionSettingsWithNativeNotes(settings, profileNotesRaw, runtime.profileNotesPreview);
  const photos: NativeMapPhoto[] = await Promise.all(photoGroups.map(async ({ photo, groupIds }) => {
    if (!(photo.preview instanceof Blob)) throw new Error(`照片 ${photo.name || photo.id} 缺少有效预览数据`);
    return serializeNativeMapPhoto(photo, await blobToBase64(photo.preview), groupIds);
  }));
  const state = {
    revision: ++runtime.stateRevision,
    settings: current.settings, mapSource, routeOverlay: current.routeOverlay,
    guidanceOverlay: current.guidanceOverlay ?? null, navigationCues: current.navigationCues ?? null,
    trackOverlay: { ...current.trackOverlay, preview: runtime.previewTrackOverride ? runtime.previewTrack : current.trackOverlay.preview ?? null },
    areaOverlay: current.areaOverlay, annotations: current.annotations, annotationSelected: current.annotationSelected,
    ...(current.annotationEditingId ? { annotationEditingId: current.annotationEditingId } : {}), photos,
    section: sectionWithNotes(current.section),
    sectionItems: current.sectionItems.map((item) => ({ ...item, settings: sectionWithNotes(item.settings) })),
    selectedSectionId: current.selectedSectionId,
    sectionEditing: current.sectionEditing, sectionCursor: current.sectionCursor, position: current.position,
    positionHeading: current.positionHeading, positionNavigating: current.positionNavigating,
    interaction: {
      readOnly: current.readOnly ?? false, drawingActive: current.drawingActive,
      roadSnapping: current.roadSnapping, nodeSnapping: current.nodeSnapping ?? false,
      riverSnapping: current.riverSnapping, pickingActive: current.pickingActive,
      annotationPicking: current.annotationPicking ?? false, measurementPicking: current.measurementPicking ?? false,
    },
    mapViewport: viewport,
    offlineDisplayPolicy: runtime.offlineDisplayPolicy,
      renderGeometry: { ...sceneGeometry(runtime, current), cad: runtime.nativeCadGeometry, transient: runtime.transientGeometry.snapshot() },
  } as NativeMapRenderState & { renderGeometry: ReturnType<typeof createNativeSceneGeometry> & { cad: FeatureCollection | null; transient: FeatureCollection } };
  if (new TextEncoder().encode(JSON.stringify(state)).byteLength > MAX_RENDER_STATE_BYTES) throw new Error('地图状态超过8 MiB桥接上限；未截断状态，原数据仍保留。');
  return state;
}

function magnify(runtime: Runtime, target: HTMLCanvasElement, point: ScreenPoint, report: (message: string) => void): () => void {
  const client = runtime.client, mapId = runtime.mapId;
  if (!client || !mapId || client.capability('capture').status !== 'ready') {
    report('原生地图帧捕获能力未就绪，放大镜没有伪造预览');
    return () => {};
  }
  let disposed = false;
  let generation = 0;
  let abort: AbortController | null = null;
  let previousFrame = -1;
  const render = () => {
    if (disposed || !runtime.frame || runtime.frame.sequence === previousFrame) return;
    previousFrame = runtime.frame.sequence;
    const current = ++generation;
    abort?.abort();
    abort = new AbortController();
    void client.request<{ dataUrl?: string; mimeType?: string; width?: number; height?: number }>(mapId, 'capture', { maxDimension: 2048 }, { signal: abort.signal }).then((capture) => {
      if (disposed || current !== generation || !capture.dataUrl) return;
      const image = new Image();
      image.onload = () => {
        if (disposed || current !== generation) return;
        const context = target.getContext('2d');
        if (!context) return;
        const viewport = runtime.viewport?.cssRect;
        if (!viewport?.width || !viewport.height) return;
        const sx = image.naturalWidth / viewport.width, sy = image.naturalHeight / viewport.height;
        const span = 32;
        context.fillStyle = '#10212b'; context.fillRect(0, 0, target.width, target.height);
        try { context.drawImage(image, (point.x - span / 2) * sx, (point.y - span / 2) * sy, span * sx, span * sy, 0, 0, target.width, target.height); }
        catch { report('原生地图放大镜捕获内容不可用'); }
      };
      image.onerror = () => { if (!disposed && current === generation) report('原生地图放大镜图像解码失败'); };
      image.src = capture.dataUrl;
    }).catch((error: unknown) => {
      if (!disposed && current === generation && (error as Error)?.name !== 'AbortError') report(`原生地图放大镜失败：${error instanceof Error ? error.message : '未知错误'}`);
    });
  };
  const unsubscribe = client.subscribe(mapId, 'renderFrame', render);
  render();
  return () => { disposed = true; generation++; abort?.abort(); unsubscribe(); };
}
