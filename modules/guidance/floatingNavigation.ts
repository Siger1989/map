import type { Coordinate } from '../navigation/types';
import type { GuidanceSession } from './session';

export type FloatingNavigationMode = 'north' | 'motion';

export type FloatingNavigationStatus = {
  available: boolean;
  enabled: boolean;
  visible: boolean;
  mode: FloatingNavigationMode;
  message: string;
};

export type FloatingNavigationPayload = {
  version: 1;
  mode: FloatingNavigationMode;
  label: string;
  coordinates: Coordinate[];
};

export type FloatingNavigationBridge = {
  status(): string;
  start(payload: string): void;
  update(payload: string): void;
  stop(): void;
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
  session: GuidanceSession,
  mode: FloatingNavigationMode,
): FloatingNavigationPayload {
  const coordinates = session.route.coordinates;
  const label = session.route.stops?.at(-1)?.name?.trim() || '导航路线';
  validateFloatingNavigationInput(mode, label, coordinates);
  return { version: 1, mode, label, coordinates };
}

export function validateFloatingNavigationInput(
  mode: FloatingNavigationMode,
  label: string,
  coordinates: readonly Coordinate[],
) {
  if (mode !== 'north' && mode !== 'motion') throw new Error('方向模式无效');
  if (label.length > MAX_LABEL_LENGTH) throw new Error('路线名称过长');
  if (coordinates.length < 2 || coordinates.length > FLOATING_NAVIGATION_MAX_POINTS) {
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
  validateFloatingNavigationInput(payload.mode, payload.label, payload.coordinates);
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
    mode: status.mode === 'motion' ? 'motion' : 'north',
    message: typeof status.message === 'string' ? status.message : '',
  };
}
