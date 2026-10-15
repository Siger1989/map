import { coordinate, metresBetween, type Coordinate } from '../navigation/types.ts';
import { headingDelta, wrapHeading, type PositionFix } from './types.ts';

export function travelBearing(a: Coordinate, b: Coordinate) {
  const r = Math.PI / 180;
  const dl = (b[0] - a[0]) * r;
  const p = a[1] * r;
  const q = b[1] * r;
  return wrapHeading(
    Math.atan2(
      Math.sin(dl) * Math.cos(q),
      Math.cos(p) * Math.sin(q) - Math.sin(p) * Math.cos(q) * Math.cos(dl),
    ) / r,
  );
}

/** Reject GPS courses that are unreliable at low speed or on a weak fix. */
export function reliableGpsCourse(fix: PositionFix): number | null {
  const { heading, headingAccuracy, speed, accuracy } = fix;
  if (
    fix.source === 'network' ||
    fix.provider === 'ip' ||
    heading === undefined ||
    !Number.isFinite(heading) ||
    heading < 0 ||
    heading >= 360 ||
    speed === undefined ||
    !Number.isFinite(speed) ||
    speed < 1.5 ||
    speed > 80 ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 25
  ) return null;

  if (headingAccuracy !== undefined)
    return Number.isFinite(headingAccuracy) && headingAccuracy >= 0 && headingAccuracy <= 25
      ? heading
      : null;

  // Browser APIs often omit headingAccuracy, so require faster travel and a tighter fix.
  return accuracy <= 12 && speed >= 2.2 ? heading : null;
}

type CourseCandidate = { heading: number; timestamp: number; count: number };

/** Acceleration can help distinguish rest, but never establishes absolute direction. */
export class MotionHeading {
  private anchor: PositionFix | null = null;
  private timestamp = 0;
  private heading: number | null = null;
  private turnCandidate: CourseCandidate | null = null;

  private acceptCourse(course: number, timestamp: number) {
    const normalized = wrapHeading(course);
    if (this.heading === null) {
      this.heading = normalized;
      this.turnCandidate = null;
      return;
    }

    const difference = headingDelta(this.heading, normalized);
    const magnitude = Math.abs(difference);
    if (magnitude < 3) { this.turnCandidate = null; return; }
    // A single large course jump is usually GPS noise. Confirm a consistent new
    // direction on the next fresh fix, while allowing gradual turns through.
    if (magnitude > 65) {
      const pending = this.turnCandidate;
      if (
        pending &&
        timestamp - pending.timestamp <= 15000 &&
        Math.abs(headingDelta(pending.heading, normalized)) <= 32
      ) {
        this.turnCandidate = null;
        this.heading = wrapHeading(this.heading + difference * 0.78);
      } else {
        this.turnCandidate = { heading: normalized, timestamp, count: 1 };
      }
      return;
    }

    this.turnCandidate = null;
    const smoothing = magnitude > 24 ? 0.55 : 0.32;
    this.heading = wrapHeading(this.heading + difference * smoothing);
  }

  update(fix: PositionFix | null, now: number, accelerationQuiet = false) {
    const result = (status: string) => ({ heading: this.heading, status });
    if (
      !fix ||
      !coordinate(fix.coordinates) ||
      !Number.isFinite(fix.timestamp) ||
      !Number.isFinite(fix.accuracy) ||
      fix.accuracy < 0 ||
      now - fix.timestamp > 10000 ||
      fix.timestamp > now + 3000
    ) return result('等待新定位，运动方向保持不变');

    if (fix.source === 'network' || fix.provider === 'ip' || fix.accuracy > 30) {
      this.anchor = null;
      this.turnCandidate = null;
      return result('等待较准确的GPS定位');
    }
    if (fix.timestamp <= this.timestamp)
      return result(this.heading === null ? '移动一段距离后确定运动方向' : '');

    this.timestamp = fix.timestamp;
    if (fix.speed !== undefined && Number.isFinite(fix.speed) && fix.speed < 0.5) {
      this.anchor = fix;
      this.turnCandidate = null;
      return result('已减速或停下，保持运动方向');
    }

    const gpsCourse = reliableGpsCourse(fix);
    if (gpsCourse !== null) {
      if (this.heading !== null && this.anchor && (fix.speed ?? 0) < 3) {
        const elapsed = fix.timestamp - this.anchor.timestamp;
        if (elapsed > 30000) { this.anchor = fix; this.turnCandidate = null; return result('等待持续移动确认方向'); }
        const displacement = metresBetween(this.anchor.coordinates, fix.coordinates);
        const minimum = Math.max(3, (this.anchor.accuracy + fix.accuracy) * 0.45);
        if (displacement < minimum) return result('小范围移动，保持运动方向');
      }
      this.acceptCourse(gpsCourse, fix.timestamp);
      this.anchor = fix;
      return result('');
    }

    if (this.anchor) {
      const seconds = (fix.timestamp - this.anchor.timestamp) / 1000;
      const distance = metresBetween(this.anchor.coordinates, fix.coordinates);
      if (seconds > 30 || seconds <= 0 || distance / seconds > 80) {
        this.anchor = fix;
        this.turnCandidate = null;
        return result('重新确认运动方向');
      }

      // Keep one movement anchor until enough net displacement accumulates.
      // This prevents small position jitter from repeatedly changing the course.
      const threshold = Math.max(
        6,
        (this.anchor.accuracy + fix.accuracy) * (accelerationQuiet ? 1.25 : 0.9),
      );
      const averageSpeed = distance / seconds;
      const slowSpeedThreshold = Math.max(0.45, (this.anchor.accuracy + fix.accuracy) / 35);
      if (distance >= threshold && averageSpeed >= slowSpeedThreshold) {
        this.acceptCourse(travelBearing(this.anchor.coordinates, fix.coordinates), fix.timestamp);
        this.anchor = fix;
        return result('');
      }
    }

    if (!this.anchor) this.anchor = fix;
    return result(this.heading === null ? '移动一段距离后确定运动方向' : '');
  }
}
