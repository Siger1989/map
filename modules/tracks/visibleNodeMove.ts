import { coordinate, metresBetween, type Coordinate } from '../navigation/types.ts';
import type { ManualTrack } from './drawing.ts';

export type VisibleNodeMoveSpan = Readonly<{
  segment: number;
  startIndex: number;
  endIndex: number;
  /** Point keys from the left fixed anchor through the right fixed anchor. */
  keys: readonly string[];
  ratios: readonly number[];
}>;

/** A drag-time snapshot. It deliberately holds the original segment arrays by identity. */
export type VisibleNodeMovePlan = Readonly<{
  sourceSegments: readonly Coordinate[][];
  fromKey: string;
  fromCoordinate: readonly [number, number];
  spans: readonly VisibleNodeMoveSpan[];
}>;

const key = (point: Coordinate) => point.join(',');
const shortLongitudeDelta = (from: number, to: number) => {
  let delta = to - from;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  if (delta === -180 && to - from > 0) delta = 180;
  return delta;
};
const wrapLongitude = (longitude: number) => longitude > 180 ? longitude - 360 : longitude < -180 ? longitude + 360 : longitude;

/** Capture the visible control intervals around every occurrence of `from`. */
export function prepareVisibleNodeMove(
  segments: Coordinate[][],
  from: Coordinate,
  controls: Iterable<Coordinate>,
): VisibleNodeMovePlan | null {
  if (!coordinate(from)) return null;
  const fromKey = key(from);
  const controlKeys = new Set([...controls].filter(coordinate).map(key));
  const occurrences = new Map<string, number>();
  segments.forEach(line => {
    let previousKey: string | null = null;
    for (const point of line) {
      const pointKey = key(point);
      if (pointKey === previousKey) continue;
      occurrences.set(pointKey, (occurrences.get(pointKey) ?? 0) + 1);
      previousKey = pointKey;
    }
  });
  const anchors = new Set(controlKeys);
  for (const [pointKey, count] of occurrences) if (count > 1) anchors.add(pointKey);
  const spans: VisibleNodeMoveSpan[] = [];
  const claimed = new Set<string>();

  segments.forEach((line, segment) => {
    for (let at = 0; at < line.length; at++) {
      if (key(line[at]) !== fromKey) continue;
      if (at > 0 && key(line[at - 1]) === fromKey) continue;
      let runEnd = at;
      while (runEnd + 1 < line.length && key(line[runEnd + 1]) === fromKey) runEnd++;
      let left = at - 1;
      while (left > 0 && (!anchors.has(key(line[left])) || key(line[left]) === fromKey)) left--;
      if (left < 0) left = 0;
      let right = runEnd + 1;
      while (right < line.length - 1 && !anchors.has(key(line[right]))) right++;
      if (right >= line.length) right = line.length - 1;
      const addSpan = (start: number, end: number) => {
        if (end - start < 2) return;
        const keys = line.slice(start, end + 1).map(key);
        const interior = keys.slice(1, -1);
        if (interior.some(pointKey => claimed.has(pointKey))) return;
        const lengths = line.slice(start + 1, end + 1).map((point, index) => metresBetween(line[start + index], point));
        const total = lengths.reduce((sum, length) => sum + length, 0);
        let travelled = 0;
        const ratios = keys.map((_, index) => {
          if (index === 0) return 0;
          if (index === keys.length - 1) return 1;
          travelled += lengths[index - 1];
          if (total > 0) return travelled / total;
          let run = 0, runs = 1;
          for (let i = 1; i < keys.length; i++) if (keys[i] !== keys[i - 1]) { runs++; if (i <= index) run++; }
          return runs <= 1 ? 0 : run / (runs - 1);
        });
        // A coordinate-key map can represent a repeated vertex only when its
        // occurrences are consecutive and therefore share one interpolation ratio.
        const seen = new Map<string, { first: number; last: number; ratio: number }>();
        for (let i = 0; i < keys.length; i++) {
          const old = seen.get(keys[i]);
          if (old) {
            if (i !== old.last + 1 || ratios[i] !== old.ratio) return;
            old.last = i;
          } else seen.set(keys[i], { first: i, last: i, ratio: ratios[i] });
        }
        spans.push(Object.freeze({ segment, startIndex: start, endIndex: end, keys: Object.freeze(keys), ratios: Object.freeze(ratios) }));
        new Set(interior).forEach(pointKey => claimed.add(pointKey));
      };
      if (left >= 0 && left < at) addSpan(left, at);
      if (right > runEnd && right < line.length) addSpan(runEnd, right);
    }
  });
  if (!segments.some(line => line.some(point => key(point) === fromKey))) return null;
  return Object.freeze({ sourceSegments: segments, fromKey, fromCoordinate: Object.freeze([...from] as [number, number]), spans: Object.freeze(spans) });
}

export function moves(plan: VisibleNodeMovePlan, to: Coordinate): ReadonlyMap<string, Coordinate> {
  if (!coordinate(to)) throw new Error('节点坐标无效。');
  const result = new Map<string, Coordinate>();
  const from = plan.fromCoordinate;
  if (from[0] === to[0] && from[1] === to[1]) return result;
  result.set(plan.fromKey, [...to] as Coordinate);
  for (const span of plan.spans) {
    const lastLine = plan.sourceSegments[span.segment];
    const leftIndex = span.startIndex;
    const rightIndex = span.endIndex;
    const a = lastLine?.[leftIndex];
    const b = lastLine?.[rightIndex];
    if (!a || !b || leftIndex < 0 || rightIndex <= leftIndex) throw new Error('编辑路线已变化，请重新选择节点。');
    const leftIsMoving = span.keys[0] === plan.fromKey;
    const rightIsMoving = span.keys.at(-1) === plan.fromKey;
    const start = leftIsMoving ? to : a;
    const end = rightIsMoving ? to : b;
    const delta = shortLongitudeDelta(start[0], end[0]);
    for (let index = 1; index < span.keys.length - 1; index++) {
      const ratio = span.ratios[index];
      result.set(span.keys[index], [wrapLongitude(start[0] + delta * ratio), start[1] + (end[1] - start[1]) * ratio]);
    }
  }
  return result;
}

function mergeDetails(a: { color?: string; note?: string } | undefined, b: { color?: string; note?: string }) {
  if (a?.color && b.color && a.color !== b.color) throw new Error('节点说明颜色冲突，请先整理后再移动。');
  const note = [...new Set([a?.note, b.note].filter(Boolean))].join('；');
  if (note.length > 1600) throw new Error('拼接点备注超过1600字，请先整理备注');
  return { ...a, ...b, ...(note ? { note } : {}) };
}

export function applyTrackVisibleNodeMove(track: ManualTrack, plan: VisibleNodeMovePlan, to: Coordinate): ManualTrack {
  if (track.segments !== plan.sourceSegments) throw new Error('编辑路线已变化，请重新选择节点。');
  if (!coordinate(to)) throw new Error('节点坐标无效。');
  const pointMoves = moves(plan, to);
  if (!pointMoves.size) return track;
  const remap = (point: Coordinate) => pointMoves.get(key(point)) ?? point;
  const pointDetails: ManualTrack['pointDetails'] = track.pointDetails ? {} : undefined;
  if (pointDetails) {
    for (const [oldKey, detail] of Object.entries(track.pointDetails!)) {
      const destination = pointMoves.get(oldKey);
      const newKey = destination ? key(destination) : oldKey;
      if (pointDetails[newKey]) pointDetails[newKey] = mergeDetails(pointDetails[newKey], detail);
      else pointDetails[newKey] = detail;
    }
  }
  return {
    ...track,
    segments: track.segments.map(line => line.some(point => pointMoves.has(key(point))) ? line.map(remap) : line),
    ...(pointDetails ? { pointDetails } : {}),
    ...(track.nodes ? { nodes: track.nodes.map(remap) } : {}),
    ...(track.routeTerminals ? { routeTerminals: Object.fromEntries(Object.entries(track.routeTerminals).map(([name, point]) => [name, remap(point)])) } : {}),
    ...(track.sharedRoute ? { sharedRoute: { ...track.sharedRoute, duration: null, stops: track.sharedRoute.stops.map(stop => ({ ...stop, coordinates: remap(stop.coordinates) })) } } : {}),
  };
}
