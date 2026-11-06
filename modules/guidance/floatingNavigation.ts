import type { Coordinate } from '../navigation/types';
import type { GuidanceSession } from './session';

export type FloatingNavigationMode = 'north' | 'motion' | 'compass';
export type FloatingNavigationKind = 'position' | 'route';

export type FloatingNavigationStatus = {
  available: boolean;
  enabled: boolean;
  visible: boolean;
  windowEnabled: boolean;
  lockscreenEnabled: boolean;
  energySaving: boolean;
  lockscreenKeepOn: boolean;
  outdoorContours: boolean;
  mode: FloatingNavigationMode;
  message: string;
  kind: FloatingNavigationKind;
  locationAllowed?: boolean;
  notificationAllowed?: boolean;
  overlayAllowed?: boolean;
  zoom?: number;
  widthDp?: number;
  heightDp?: number;
};

export type FloatingNavigationPayload = {
  version: 1;
  mode: FloatingNavigationMode;
  label: string;
  coordinates: Coordinate[];
  kind?: FloatingNavigationKind;
  color?: string;
  windowEnabled?: boolean;
  lockscreenEnabled?: boolean;
  energySaving?: boolean;
  lockscreenKeepOn?: boolean;
  outdoorContours?: boolean;
};

export type FloatingNavigationOptions = Partial<Pick<FloatingNavigationStatus, 'windowEnabled' | 'lockscreenEnabled' | 'energySaving' | 'lockscreenKeepOn' | 'outdoorContours' | 'mode'>>;

export type FloatingNavigationBridge = {
  status(): string;
  start(payload: string): void;
  update(payload: string): void;
  stop(): void;
  restore?(payload: string): void;
  setOptions?(payload: string): void;
};

declare global {
  interface Window {
    ShantuFloatingNavigation?: FloatingNavigationBridge;
  }
}

export const FLOATING_NAVIGATION_MAX_POINTS = 100_000;
export const FLOATING_NAVIGATION_MAX_BYTES = 4 * 1024 * 1024;
const MAX_LABEL_LENGTH = 160;

export function buildFloatingNavigationPayload(
  session: GuidanceSession | null,
  mode: FloatingNavigationMode,
  kind: FloatingNavigationKind = session ? 'route' : 'position',
  options?: Pick<FloatingNavigationOptions, 'windowEnabled' | 'lockscreenEnabled' | 'outdoorContours'>,
): FloatingNavigationPayload {
  const displayOptions = options ? {
    ...(typeof options.windowEnabled === 'boolean' ? { windowEnabled: options.windowEnabled } : {}),
    ...(typeof options.lockscreenEnabled === 'boolean' ? { lockscreenEnabled: options.lockscreenEnabled } : {}),
    ...(typeof options.outdoorContours === 'boolean' ? { outdoorContours: options.outdoorContours } : {}),
  } : {};
  if (kind === 'position') return { version: 1, kind, mode, label: '定位小地图', coordinates: [], ...displayOptions };
  if (!session) throw new Error('无导航路线时悬浮地图自动使用定位模式');
  const coordinates = session.route.coordinates;
  const label = session.route.stops?.at(-1)?.name?.trim() || '导航路线';
  validateFloatingNavigationInput(mode, label, coordinates);
  const color = session.route.style?.color;
  if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('路线颜色必须为六位十六进制');
  return { version: 1, kind, mode, label, coordinates, ...(color ? { color: color.toUpperCase() } : {}), ...displayOptions };
}

export function serializeFloatingNavigationOptions(options: FloatingNavigationOptions) {
  if (!Object.keys(options).length) throw new Error('悬浮地图设置为空');
  const allowed = new Set(['windowEnabled', 'lockscreenEnabled', 'energySaving', 'lockscreenKeepOn', 'outdoorContours', 'mode']);
  if (Object.keys(options).some((key) => !allowed.has(key))) throw new Error('悬浮地图设置字段无效');
  if (options.mode !== undefined && !(['north', 'motion', 'compass'] as string[]).includes(options.mode)) throw new Error('方向模式无效');
  if (options.windowEnabled !== undefined && typeof options.windowEnabled !== 'boolean') throw new Error('windowEnabled必须为布尔值');
  if (options.lockscreenEnabled !== undefined && typeof options.lockscreenEnabled !== 'boolean') throw new Error('lockscreenEnabled必须为布尔值');
  if (options.energySaving !== undefined && typeof options.energySaving !== 'boolean') throw new Error('energySaving必须为布尔值');
  if (options.lockscreenKeepOn !== undefined && typeof options.lockscreenKeepOn !== 'boolean') throw new Error('lockscreenKeepOn必须为布尔值');
  if (options.outdoorContours !== undefined && typeof options.outdoorContours !== 'boolean') throw new Error('outdoorContours必须为布尔值');
  return JSON.stringify(options);
}

export function validateFloatingNavigationInput(
  mode: FloatingNavigationMode,
  label: string,
  coordinates: readonly Coordinate[],
  kind: FloatingNavigationKind = 'route',
) {
  if (!(['north', 'motion', 'compass'] as string[]).includes(mode)) throw new Error('方向模式无效');
  if (label.length > MAX_LABEL_LENGTH) throw new Error('路线名称过长');
  if (kind !== 'route' && kind !== 'position') throw new Error('悬浮地图类型无效');
  if (kind === 'position' && coordinates.length !== 0) throw new Error('定位小地图不应包含路线');
  if (kind === 'route' && (coordinates.length < 2 || coordinates.length > FLOATING_NAVIGATION_MAX_POINTS)) {
    throw new Error('路线点数必须为2至100000');
  }
  for (const point of coordinates) {
    if (!Array.isArray(point) || point.length < 2 ||
      !Number.isFinite(point[0]) || point[0] < -180 || point[0] > 180 ||
      !Number.isFinite(point[1]) || point[1] < -90 || point[1] > 90) {
      throw new Error('路线坐标无效');
    }
  }
  return true;
}

export function serializeFloatingNavigationPayload(payload: FloatingNavigationPayload) {
  validateFloatingNavigationInput(payload.mode, payload.label, payload.coordinates, payload.kind);
  if (payload.color !== undefined && (payload.kind === 'position' || !/^#[0-9a-f]{6}$/i.test(payload.color)))
    throw new Error('仅导航路线支持六位十六进制颜色');
  if (payload.windowEnabled !== undefined && typeof payload.windowEnabled !== 'boolean') throw new Error('windowEnabled必须为布尔值');
  if (payload.lockscreenEnabled !== undefined && typeof payload.lockscreenEnabled !== 'boolean') throw new Error('lockscreenEnabled必须为布尔值');
  if (payload.energySaving !== undefined && typeof payload.energySaving !== 'boolean') throw new Error('energySaving必须为布尔值');
  if (payload.lockscreenKeepOn !== undefined && typeof payload.lockscreenKeepOn !== 'boolean') throw new Error('lockscreenKeepOn必须为布尔值');
  if (payload.outdoorContours !== undefined && typeof payload.outdoorContours !== 'boolean') throw new Error('outdoorContours必须为布尔值');
  const allowed = new Set(['version', 'mode', 'label', 'coordinates', 'kind', 'color', 'windowEnabled', 'lockscreenEnabled', 'energySaving', 'lockscreenKeepOn', 'outdoorContours']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) throw new Error('悬浮地图数据字段无效');
  const serialized = JSON.stringify(payload);
  validateFloatingNavigationPayloadBytes(serialized);
  return serialized;
}

export function validateFloatingNavigationPayloadBytes(serialized: string) {
  if (new TextEncoder().encode(serialized).byteLength > FLOATING_NAVIGATION_MAX_BYTES) {
    throw new Error('路线数据超过4MiB上限');
  }
  return true;
}

export function parseFloatingNavigationStatus(raw: unknown): FloatingNavigationStatus | null {
  let value = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  const status = value as Partial<FloatingNavigationStatus>;
  return {
    available: status.available === true,
    enabled: status.enabled === true,
    visible: status.visible === true,
    windowEnabled: status.windowEnabled !== false,
    lockscreenEnabled: status.lockscreenEnabled !== false,
    energySaving: status.energySaving === true,
    lockscreenKeepOn: status.lockscreenKeepOn === true,
    outdoorContours: status.outdoorContours === true,
    mode: status.mode === 'motion' || status.mode === 'compass' ? status.mode : 'north',
    message: typeof status.message === 'string' ? status.message : '',
    kind: status.kind === 'position' ? 'position' : 'route',
    ...(typeof status.locationAllowed === 'boolean' ? { locationAllowed: status.locationAllowed } : {}),
    ...(typeof status.notificationAllowed === 'boolean' ? { notificationAllowed: status.notificationAllowed } : {}),
    ...(typeof status.overlayAllowed === 'boolean' ? { overlayAllowed: status.overlayAllowed } : {}),
    ...(typeof status.zoom === 'number' && Number.isFinite(status.zoom) ? { zoom: status.zoom } : {}),
    ...(typeof status.widthDp === 'number' && Number.isFinite(status.widthDp) ? { widthDp: status.widthDp } : {}),
    ...(typeof status.heightDp === 'number' && Number.isFinite(status.heightDp) ? { heightDp: status.heightDp } : {}),
  };
}
