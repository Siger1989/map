import type { Coordinate } from '../navigation/types';
import { MAX_TRACK_POINTS, pullTip, type ScreenPoint } from './drawing.ts';
import { aimPoint, handlePoint, nearHandle } from './precision.ts';
import { findSnap, sameNode } from './snapping.ts';
import type { DrawingInput } from './DrawingGestureBridge';
import type { DrawingMode } from './draft';

export type DrawingPreview = {
  kind: 'aim' | 'ink';
  tip: ScreenPoint;
  finger: ScreenPoint;
  path: string;
  snapped: boolean;
};
export type DrawingResult = {
  preview: DrawingPreview | null;
  hint: string;
  anchor?: Coordinate;
  vertex?: Coordinate;
  stroke?: Coordinate[];
};
type Options = {
  mode: DrawingMode;
  anchor: Coordinate | null;
  length: number;
  width: number;
  height: number;
  candidates: Coordinate[];
  snapping: boolean;
  project: (point: Coordinate) => ScreenPoint | null;
  unproject: (point: ScreenPoint) => Coordinate | null;
};
/** Input state is separate from rendering so handoff and exact endpoints can be checked. */
export class DrawingSession {
  private aim: Coordinate | null = null;
  private stroke: {
    tip: ScreenPoint;
    sample: ScreenPoint;
    points: Coordinate[];
    path: string;
    travelled: number;
    snap: Coordinate | null;
  } | null = null;
  clear() {
    this.aim = null;
    this.stroke = null;
  }
  input(event: DrawingInput, o: Options): DrawingResult {
    const empty = { preview: null, hint: '' };
    if (event.type === 'cancel') {
      this.clear();
      return empty;
    }
    if (event.type === 'end') {
      const s = this.stroke,
        aim = this.aim;
      this.clear();
      if (s && s.points.length > 1) {
        // The visible magnet is the final geographic endpoint, never the finger.
        if (s.snap) s.points.push(s.snap);
        return { ...empty, stroke: s.points };
      }
      if (aim && event.reason === 'release')
        return o.mode === 'points'
          ? { ...empty, vertex: aim }
          : { ...empty, anchor: aim };
      return empty;
    }
    const finger = event.point;
    if (event.type === 'start') {
      this.clear();
      if (o.mode === 'freehand' && o.anchor) {
        const tip = o.project(o.anchor);
        if (
          !tip ||
          tip.x < 8 ||
          tip.y < 8 ||
          tip.x > o.width - 8 ||
          tip.y > o.height - 8
        )
          return {
            ...empty,
            hint: '端点在视野外，双指移动地图或点“定位端点”。',
          };
        if (!nearHandle(finger, handlePoint(tip, o.length, o.height)))
          return {
            ...empty,
            hint: '从端点旁的绿色牵引环开始拖动；双指随时控图。',
          };
        this.stroke = {
          tip,
          sample: tip,
          points: [o.anchor],
          path: `M ${tip.x} ${tip.y}`,
          travelled: 0,
          snap: null,
        };
        return {
          ...empty,
          preview: {
            kind: 'ink',
            tip,
            finger,
            path: this.stroke.path,
            snapped: false,
          },
        };
      }
    }
    const s = this.stroke;
    if (s) {
      const tip = pullTip(s.tip, finger, o.length);
      s.travelled += Math.hypot(tip.x - s.tip.x, tip.y - s.tip.y);
      s.tip = tip;
      const point = o.unproject(tip);
      if (!point) {
        s.snap = null;
        return {
          preview: {
            kind: 'ink',
            tip: s.sample,
            finger,
            path: s.path,
            snapped: false,
          },
          hint: '已到地面边界，松手后双指调整地图。',
        };
      }
      if (
        Math.hypot(tip.x - s.sample.x, tip.y - s.sample.y) >= 2 &&
        s.points.length < MAX_TRACK_POINTS - 1
      ) {
        s.points.push(point);
        s.sample = tip;
        s.path += ` L ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`;
      }
      const candidates =
        s.travelled > o.length * 2
          ? [...o.candidates, s.points[0]]
          : o.candidates.filter((c) => !sameNode(c, s.points[0]));
      const snap =
        o.snapping && s.points.length > 1
          ? findSnap(tip, candidates, o.project)
          : null;
      s.snap = snap?.coordinate ?? null;
      return {
        hint: snap ? '已吸附 · 松手连接' : '',
        preview: {
          kind: 'ink',
          finger,
          tip: snap?.screen ?? tip,
          path: s.path + (snap ? ` L ${snap.screen.x} ${snap.screen.y}` : ''),
          snapped: !!snap,
        },
      };
    }
    // A missed handle must not turn into an unrequested new origin during movement.
    if (o.mode === 'freehand' && o.anchor) return empty;
    const aim = aimPoint(finger, o.width, o.height),
      ground = o.unproject(aim);
    if (!ground) {
      this.aim = null;
      return { ...empty, hint: '准星需要对准地面，双指可调整视角。' };
    }
    const snap = o.snapping ? findSnap(aim, o.candidates, o.project) : null;
    this.aim = snap?.coordinate ?? ground;
    return {
      hint: snap ? '已吸附 · 松手定点' : '',
      preview: {
        kind: 'aim',
        tip: snap?.screen ?? aim,
        finger,
        path: '',
        snapped: !!snap,
      },
    };
  }
}
