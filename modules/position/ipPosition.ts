import { coordinate } from '../navigation/types.ts';
import type { PositionFix } from './types';

export function readIpPosition(value: unknown, now = Date.now()): PositionFix | null {
  const fix = value as Partial<PositionFix> | null;
  if (!fix || fix.source !== 'network' || fix.provider !== 'ip' || !coordinate(fix.coordinates) ||
      fix.accuracy !== 50000 || !Number.isFinite(fix.timestamp) || now - fix.timestamp! > 10000 || fix.timestamp! > now + 5000) return null;
  return { coordinates: fix.coordinates, accuracy: 50000, timestamp: fix.timestamp!, source: 'network', provider: 'ip' };
}

export function watchIpPosition(onFix: (fix: PositionFix) => void, onError: (error: string) => void) {
  let stopped = false, request: AbortController | null = null;
  const update = async () => {
    if (stopped || request || document.hidden) return;
    const controller = new AbortController();
    request = controller;
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/location/ip', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw Error('IP定位暂不可用，请检查网络或切换自动定位。');
      const fix = readIpPosition(await response.json());
      if (!fix) throw Error('IP定位结果无效，请重试。');
      if (!stopped) onFix(fix);
    } catch (error) {
      if (!stopped) onError(error instanceof Error && error.name !== 'AbortError' ? error.message : 'IP定位超时，请重试。');
    } finally {
      window.clearTimeout(timeout);
      request = null;
    }
  };
  void update();
  const timer = window.setInterval(() => void update(), 60000);
  const visible = () => { if (!document.hidden) void update(); };
  document.addEventListener('visibilitychange', visible);
  return () => { stopped = true; request?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
}
