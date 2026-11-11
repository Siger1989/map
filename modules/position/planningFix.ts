import { coordinate, metresBetween } from '../navigation/types.ts';
import type { PositionFix } from './types';

export function planningFixIssue(fix: PositionFix | null, now = Date.now()): string {
  if (!fix) return '尚无设备定位，请等待更新或手动选点';
  if (fix.provider === 'ip') return '仅有 IP 估算位置，请等待设备定位或手动选点';
  if (!coordinate(fix.coordinates)) return '设备位置坐标无效，请等待更新或手动选点';
  if (!Number.isFinite(fix.timestamp) || now - fix.timestamp > 30_000 || fix.timestamp > now + 5_000)
    return '定位已过期，请等待设备位置更新';
  if (!Number.isFinite(fix.accuracy) || fix.accuracy < 0) return '定位精度未知，请等待设备位置更新';
  if (fix.accuracy > 1_000) return '定位精度约±' + Math.round(fix.accuracy) + '米，精度不足，请等待更准确的定位或手动选点';
  return '';
}

/** A real device fix can provide an estimated route origin, never live navigation progress. */
export const planningFix = (fix: PositionFix | null, now = Date.now()): fix is PositionFix =>
  !planningFixIssue(fix, now);

export function estimatedPlanningPosition(fix: PositionFix): string {
  return (fix.source === 'network' ? '网络估算位置' : '估算位置') +
    '（精度约±' + Math.round(fix.accuracy) + '米），可用于路线规划，等待准确 GPS 后更新导航进度';
}

/** A newer but distant sample invalidates the planned origin, even if it is on the returned path. */
export function checkPlanningPosition(origin: PositionFix, live: PositionFix | null, now = Date.now()): PositionFix {
  if (!planningFix(live, now)) throw new Error(planningFixIssue(live, now));
  if (live.timestamp < origin.timestamp ||
      metresBetween(origin.coordinates, live.coordinates) > Math.min(150, Math.max(35, origin.accuracy + live.accuracy + 10)))
    throw new Error('位置已变化，请等待稳定定位后重新规划。');
  return live;
}
