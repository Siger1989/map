import type { AreaOverlay } from '../../areas/AreaLayer';
import type { Annotation } from '../../annotations/data';
import type { CameraSnapshot } from '../../controls/useMapFocusLock';
import type { SectionSettings } from '../../section/types';
import type { SectionObject } from '../../section/sectionObjects';
import type { ProfilePoint } from '../../section/contours';
import type { LayerSettings } from '../types';
import type { MapSource } from '../../mapSources/types';
import type { RouteOverlay } from '../../navigation/types';
import type { NavigationCueInput } from '../../guidance/navigationCueGeometry';
import type { TrackOverlay } from '../../tracks/TrackLayer';
import type { PositionFix } from '../../position/types';
import type { VisiblePhoto } from '../../photos/storage';
import type { GuidanceOverlay } from '../../guidance/GuidanceLayer';
import type { NativeOfflineDisplayPolicyPayload } from './offlineMode.ts';

export const NATIVE_MAP_PROTOCOL_VERSION = 1 as const;
export type NativeMapId = string;
export type NativeMapCommand =
  | 'hello' | 'create' | 'cancel' | 'dispose' | 'mapViewport' | 'renderState' | 'batch'
  | 'camera' | 'applyCamera' | 'restoreCamera'
  | 'zoom' | 'north' | 'reset' | 'view' | 'fitRoute' | 'fitCollection' | 'focusPoint'
  | 'followPosition' | 'followNavigation' | 'previewNavigation' | 'stop' | 'drawingInput'
  | 'pick' | 'project' | 'unproject' | 'getElevation' | 'capture' | 'setTerrainMode'
  | 'refreshSection' | 'refreshSatellite' | 'refreshGeology' | 'retrySource' | 'geometryQuery';

export type NativeMapRequest = {
  version: 1;
  sessionId?: string;
  requestId: string;
  mapId: NativeMapId;
  command: NativeMapCommand | (string & {});
  payload?: unknown;
};

export type NativeMapHostMessage = {
  version: 1;
  sessionId?: string;
  requestId?: string;
  mapId?: NativeMapId;
  type: 'result' | 'error' | 'event';
  /** Canonical host events use payload:{name,value}; payload may be a direct result for result/error. */
  payload?: unknown;
  /** Accepted only for compatibility with an earlier host draft. */
  event?: { name?: string; value?: unknown } | string;
  error?: { code?: string; message?: string; details?: unknown } | string;
  name?: string;
  value?: unknown;
};

export type NativeMapCapability =
  | { status: 'ready' }
  | { status: 'blocked'; reason: string };

/** Wire form contains only map-sized preview bytes; original detail Blob stays in photo storage. */
export type NativeMapPhoto = Omit<VisiblePhoto, 'preview' | 'url' | 'detail'> & {
  previewBase64: string;
  groupIds: string[];
  groupCount: number;
};

/** Serializable mirror of the original TerrainMap business/render props. */
export type NativeMapRenderState = {
  revision: number;
  settings: LayerSettings;
  mapSource: (MapSource & { nativeAssetId?: string }) | null;
  routeOverlay: RouteOverlay;
  guidanceOverlay: GuidanceOverlay | null;
  navigationCues: NavigationCueInput | null;
  trackOverlay: TrackOverlay;
  areaOverlay: AreaOverlay;
  annotations: Annotation[];
  annotationSelected: string | null;
  annotationEditingId?: string;
  photos: NativeMapPhoto[];
  section: SectionSettings;
  sectionItems: SectionObject[];
  selectedSectionId: string | null;
  sectionEditing: boolean;
  sectionCursor: ProfilePoint | null;
  position: PositionFix | null;
  positionHeading?: number | null;
  positionNavigating?: boolean;
  interaction: {
    readOnly: boolean;
    drawingActive: boolean;
    roadSnapping: boolean;
    nodeSnapping: boolean;
    riverSnapping: boolean;
    pickingActive: boolean;
    annotationPicking: boolean;
    measurementPicking: boolean;
  };
  mapViewport: NativeMapViewport;
  offlineDisplayPolicy?: NativeOfflineDisplayPolicyPayload;
};
export type NativeMapRenderStateAck = { applied: boolean; revision: number; reason?: string };

/** CSS coordinate contract used by DOM callers and React layout. */
export type NativeMapViewport = {
  cssRect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
  clientViewportWidth: number;
};

export type NativeProjectionFrame = {
  sequence: number;
  camera: CameraSnapshot;
  viewProjection: number[];
  inverseViewProjection: number[];
  /** Physical framebuffer viewport; x/y are in physical pixels. */
  viewport: { x: number; y: number; width: number; height: number };
  /** Physical framebuffer pixels per CSS pixel. */
  cssScale: number;
  clipDepth: 'minusOneToOne' | 'zeroToOne';
  demRevision: number;
  /** False when the native map renders the reference ellipsoid without terrain. Defaults to true for older hosts. */
  terrainEnabled?: boolean;
  /** Display-only terrain scaling. Cached heights remain factual, unscaled meters. */
  verticalExaggeration?: number;
  capturedAt: number;
};

export type NativeDemTile = {
  id: string;
  west: number;
  south: number;
  east: number;
  north: number;
  width: number;
  height: number;
  /** Row-major, north-to-south meters above the WGS84 ellipsoid; null means no-data. */
  heights: Array<number | null>;
};

export type NativeMapHello = {
  capabilities: Record<string, NativeMapCapability>;
  mapIds?: NativeMapId[];
  protocolVersion?: number;
};

export type NativeMapBridgeTransport = { postMessage(message: string): void };

declare global {
  interface Window {
    ShantuNativeMap?: NativeMapBridgeTransport;
  }
}
