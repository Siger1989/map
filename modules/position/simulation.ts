export type SimFix = { longitude: number; latitude: number; speed: number; heading: number; accuracy: number; timestamp: number };
export type SimMode = 'walk' | 'run' | 'cycle' | 'custom';
export function playbackDistance(distance: number, speed: number, elapsedMs: number, running: boolean, maxElapsedMs = 1000) {
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(speed) || speed < 0 || !Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(maxElapsedMs) || maxElapsedMs <= 0) throw new Error('播放时间或距离无效');
  return running ? distance + speed * Math.min(elapsedMs, maxElapsedMs) / 1000 : distance;
}
export type SimPosition = { coords: { longitude: number; latitude: number; accuracy: number; altitude: null; altitudeAccuracy: null; heading: number | null; speed: number }; timestamp: number };
export function createSimulationGeoApi() {
  let sequence = 0, latest: SimPosition | null = null, unavailable = false;
  const watches = new Map<number, { success: (position: SimPosition) => void; error?: (error: { code: number; message: string }) => void }>();
  const error = () => ({ code: 3, message: unavailable ? '模拟定位：GPS信号超时' : '模拟定位尚未启动' });
  const deliver = (watch: { success: (position: SimPosition) => void; error?: (error: { code: number; message: string }) => void }) => unavailable || !latest ? watch.error?.(error()) : watch.success(latest);
  return {
    watchPosition(success: (position: SimPosition) => void, onError?: (error: { code: number; message: string }) => void) { const id = ++sequence, watch = { success, error: onError }; watches.set(id, watch); deliver(watch); return id; },
    getCurrentPosition(success: (position: SimPosition) => void, onError?: (error: { code: number; message: string }) => void) { deliver({ success, error: onError }); },
    clearWatch(id: number) { watches.delete(id); },
    publish(position: SimPosition) { latest = position; unavailable = false; for (const watch of watches.values()) watch.success(position); },
    lose() { unavailable = true; latest = null; for (const watch of watches.values()) watch.error?.(error()); },
    count() { return watches.size; },
  };
}
export const SIM_SPEEDS: Record<Exclude<SimMode, 'custom'>, number> = { walk: 1.4, run: 3, cycle: 6 };
export function normalizeHeading(value: number) {
  if (!Number.isFinite(value)) throw new Error('方向必须是有效数字');
  return ((value % 360) + 360) % 360;
}
export function makeSimFix(longitude: number, latitude: number, speed: number, heading: number, accuracy = 5, timestamp = Date.now()): SimFix {
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('经纬度无效');
  if (!Number.isFinite(speed) || speed < 0 || !Number.isFinite(accuracy) || accuracy < 0) throw new Error('速度或精度无效');
  return { longitude, latitude, speed, heading: normalizeHeading(heading), accuracy, timestamp };
}
export function advanceFix(fix: SimFix, distance: number, heading = fix.heading, speed = fix.speed, timestamp = Date.now()): SimFix {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('移动距离无效');
  const rad = normalizeHeading(heading) * Math.PI / 180, latRad = fix.latitude * Math.PI / 180;
  const dLat = distance * Math.cos(rad) / 111320;
  const dLng = distance * Math.sin(rad) / (111320 * Math.max(0.01, Math.cos(latRad)));
  return makeSimFix(fix.longitude + dLng, fix.latitude + dLat, speed, heading, fix.accuracy, timestamp);
}
export function interpolateLoop(points: Array<[number, number]>, distance: number): { point: [number, number]; heading: number } {
  if (points.length < 2 || !Number.isFinite(distance) || distance < 0) throw new Error('路线至少需要两个有效点');
  const lengths = points.slice(1).map((p, i) => {
    const a = points[i], dx = (p[0] - a[0]) * Math.cos(a[1] * Math.PI / 180) * 111320, dy = (p[1] - a[1]) * 111320;
    return Math.hypot(dx, dy);
  });
  const total = lengths.reduce((a, b) => a + b, 0), target = distance % total;
  let rest = target;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i];
    if (rest <= len || i === lengths.length - 1) {
      const t = len ? rest / len : 0, a = points[i], b = points[i + 1], dx = (b[0] - a[0]) * Math.cos(a[1] * Math.PI / 180), dy = b[1] - a[1];
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading: normalizeHeading(Math.atan2(dx, dy) * 180 / Math.PI) };
    }
    rest -= len;
  }
  throw new Error('路线距离计算失败');
}
