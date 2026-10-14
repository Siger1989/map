import { coordinate, metresBetween, type Coordinate } from '../navigation/types.ts';
import type { PositionFix } from '../position/types.ts';
import { pointAt, type Path } from './geometry.ts';

export type NavigationPositionAssessment = {
  kind: 'uncertain' | 'parallel' | 'away';
  message: string;
  /** A visual direction reference only; this never certifies a passable road. */
  allowReference: boolean;
};

const deltaAngle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
function bearing(a: Coordinate, b: Coordinate) {
  const x = (((b[0] - a[0] + 540) % 360) - 180) * Math.cos((a[1] + b[1]) * Math.PI / 360);
  const y = b[1] - a[1];
  return ((Math.atan2(x, y) * 180 / Math.PI) + 360) % 360;
}
function course(fix: PositionFix) {
  return Number.isFinite(fix.heading) && fix.heading! >= 0 && fix.heading! < 360 &&
    Number.isFinite(fix.speed) && fix.speed! >= 1 && fix.speed! <= 80 &&
    (fix.headingAccuracy ?? 0) >= 0 && (fix.headingAccuracy ?? 0) <= 35
    ? fix.heading : undefined;
}

/** Classify motion relative to the planned line, without claiming road identity. */
export function assessNavigationPosition(
  path: Path,
  progress: number,
  offset: number,
  fix: PositionFix,
  previous: PositionFix | null,
  previousOffset: number,
): NavigationPositionAssessment | undefined {
  if (!coordinate(fix.coordinates) || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 ||
    !Number.isFinite(offset) || !Number.isFinite(progress) ||
    offset <= Math.max(12, fix.accuracy + 5)) return undefined;
  const uncertain = (message = '位置偏移 · 道路待确认', allowReference = true): NavigationPositionAssessment =>
    ({ kind: 'uncertain', message, allowReference });
  if (fix.source === 'network' || fix.provider === 'ip' || fix.accuracy > 25)
    return uncertain('定位精度不足 · 等待稳定位置', false);
  if (offset > 100) return uncertain('距规划线较远 · 待确认偏航', false);
  if (!previous || !coordinate(previous.coordinates) || !Number.isFinite(previous.accuracy) ||
    previous.accuracy < 0 || previous.accuracy > 25 || previous.source === 'network' || previous.provider === 'ip' ||
    !Number.isFinite(fix.timestamp) || !Number.isFinite(previous.timestamp)) return uncertain();
  const elapsed = (fix.timestamp - previous.timestamp) / 1000;
  if (elapsed <= 0 || elapsed > 15) return uncertain();
  const displacement = metresBetween(previous.coordinates, fix.coordinates);
  // Movement below the two fixes' uncertainty cannot establish a direction.
  const motionFloor = Math.max(8, (fix.accuracy + previous.accuracy) * 0.7);
  let direction = displacement >= motionFloor && displacement <= 80 * elapsed + motionFloor
    ? bearing(previous.coordinates, fix.coordinates) : undefined;
  const currentCourse = course(fix), previousCourse = course(previous);
  if (direction === undefined && currentCourse !== undefined && previousCourse !== undefined &&
    deltaAngle(currentCourse, previousCourse) <= 25) direction = currentCourse;
  if (direction === undefined) return uncertain();
  const at = Math.max(0, Math.min(path.length, progress));
  const from = pointAt(path, Math.max(0, at - 4));
  const to = pointAt(path, Math.min(path.length, at + 8));
  if (metresBetween(from, to) < 2) return uncertain();
  const angle = deltaAngle(direction, bearing(from, to));
  const increasing = Number.isFinite(previousOffset) && offset - previousOffset > Math.max(8, fix.accuracy * 0.5);
  if (angle >= 145 || (angle >= 60 && increasing))
    return { kind: 'away', message: angle >= 145 ? '行进方向与路线相反 · 待确认' : '正在远离规划线 · 待确认偏航', allowReference: false };
  if (angle <= 35)
    return { kind: 'parallel', message: '沿规划线旁侧行进 · 道路待确认', allowReference: true };
  return uncertain();
}
