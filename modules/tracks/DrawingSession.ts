import type { Coordinate } from '../navigation/types';
import { MAX_TRACK_POINTS, pullTip, type ScreenPoint } from './drawing.ts';
import { aimPoint, handlePoint, nearHandle } from './precision.ts';
import { findSnap, sameNode } from './snapping.ts';
import type { DrawingInput } from './DrawingGestureBridge';
import type { DrawingMode } from './draft';
import {
  roadHint,
  roadSection,
  type RoadMatch,
  type RoadSnapper,
} from './roadSnapping.ts';

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
  roadSnapping?: boolean;
  snapRoad?: RoadSnapper;
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
    road: RoadMatch | null;
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
        if (
          s.snap &&
          !sameNode(s.points.at(-1)!, s.snap) &&
          s.points.length < MAX_TRACK_POINTS
        )
          s.points.push(s.snap);
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
          road: null,
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
        s.road = null;
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
      const road = o.roadSnapping ? o.snapRoad?.(tip, s.road) : undefined;
      let roadMatch = road?.match ?? null;
      const section =
        s.road && roadMatch ? roadSection(s.road, roadMatch, o.project) : null;
      if (
        s.road &&
        roadMatch &&
        s.road.line.id === roadMatch.line.id &&
        !section
      )
        roadMatch = null;
      const output = roadMatch?.screen ?? tip;
      if (Math.hypot(output.x - s.sample.x, output.y - s.sample.y) >= 2) {
        const points = roadMatch
          ? (section ?? [roadMatch.coordinate])
          : [point];
        if (s.points.length + points.length < MAX_TRACK_POINTS) {
          for (const next of points) {
            const screen = o.project(next);
            if (!screen) continue;
            s.points.push(next);
            s.sample = screen;
            s.path += ` L ${screen.x.toFixed(1)} ${screen.y.toFixed(1)}`;
          }
          s.road = roadMatch;
        }
      } else if (!roadMatch) s.road = null;
      const candidates =
        s.travelled > o.length * 2
          ? [...o.candidates, s.points[0]]
          : o.candidates.filter((c) => !sameNode(c, s.points[0]));
      const snap =
        o.snapping && !roadMatch && s.points.length > 1
          ? findSnap(tip, candidates, o.project)
          : null;
      s.snap = snap?.coordinate ?? roadMatch?.coordinate ?? null;
      return {
        hint: snap
          ? '已吸附节点 · 松手连接'
          : road
            ? roadHint({ ...road, match: roadMatch })
            : '',
        preview: {
          kind: 'ink',
          finger,
          tip: snap?.screen ?? output,
          path:
            s.path +
            (snap || roadMatch ? ` L ${output.x} ${output.y}` : '') +
            (snap ? ` L ${snap.screen.x} ${snap.screen.y}` : ''),
          snapped: !!snap || !!roadMatch,
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
    const road = o.roadSnapping ? o.snapRoad?.(aim, null) : undefined;
    this.aim = road?.match?.coordinate ?? snap?.coordinate ?? ground;
    return {
      hint: road?.match
        ? roadHint(road)
        : snap
          ? '已吸附节点 · 松手定点'
          : road
            ? roadHint(road)
            : '',
      preview: {
        kind: 'aim',
        tip: road?.match?.screen ?? snap?.screen ?? aim,
        finger,
        path: '',
        snapped: !!snap || !!road?.match,
      },
    };
  }
}
