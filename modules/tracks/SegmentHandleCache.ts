import type { Coordinate } from '../navigation/types.ts';
import type { ScreenPoint } from './drawing.ts';
import { nodeHandles } from './editing.ts';
import { SnapCandidateIndex, isValidSnapViewport, type SnapViewport } from './snapping.ts';

type SegmentEntry = {
  segment: Coordinate[];
  keys: Set<string>;
  plain: Coordinate[];
  sampled?: { epoch: number; positions: Coordinate[]; visible: Coordinate[] };
  geographic?: SnapCandidateIndex;
  indexByKey: Map<string, number[]>;
  visible?: Coordinate[];
};

type RouteEntry = {
  segments: Coordinate[][];
  explicit: Coordinate[];
  expanded: boolean;
  epoch: number;
  segmentEntries: SegmentEntry[];
  positions: Coordinate[];
  boundaries: Coordinate[];
  viewportKey: string;
  topology: Map<string, Coordinate>;
  handleIndices: number[][];
  boundaryIndices: number[][];
  topologySignature: string;
  detailToken: string;
  lockedHidden: number[][];
  lockedControls: number[][];
};

const keyOf = (point: Coordinate) => point.join(',');

/**
 * Caches the per-segment screen-space handles for one map instance. Geographic
 * membership is cached by immutable segment identity and remains valid across
 * camera epochs; projected spacing handles are valid only for their epoch.
 */
export class SegmentHandleCache {
  private routes = new Map<string, RouteEntry>();
  private coordinateIndices = new WeakMap<Coordinate[], Map<string, number[]>>();

  get(
    trackId: string,
    segments: Coordinate[][],
    explicit: Coordinate[],
    expanded: boolean,
    epoch: number,
    project: (point: Coordinate) => ScreenPoint,
    moving = false,
    viewport?: SnapViewport | null,
    detailKey?: string | number,
  ): Coordinate[] {
    const validViewport = isValidSnapViewport(viewport);
    if (moving && !validViewport && detailKey === undefined) {
      this.routes.delete(trackId);
      return nodeHandles(segments, explicit, expanded, project);
    }

    const previous = this.routes.get(trackId);
    const detailToken = JSON.stringify(detailKey ?? epoch);
    const viewportKey = isValidSnapViewport(viewport)
      ? JSON.stringify([viewport.west, viewport.south, viewport.east, viewport.north, viewport.width, viewport.height, viewport.revision])
      : '';
    if (previous && previous.segments === segments && previous.explicit === explicit &&
        previous.expanded === expanded && previous.viewportKey === viewportKey && previous.detailToken === detailToken && (!expanded || previous.epoch === epoch))
      return previous.positions.slice();
    const topologySignature = previous?.segments === segments ? previous.topologySignature : this.topologySignature(segments);
    // Lock positions by vertex index across edits even when a drag creates or
    // removes a shared coordinate (topology signature) or node handles are
    // temporarily collapsed.  Segment count/length are the safe remapping
    // boundary; if either changes, indices may no longer refer to the same
    // original vertices and the detail plan must be rebuilt.
    const sameShape = !!previous && previous.segments.length === segments.length &&
      previous.handleIndices.length === segments.length &&
      previous.segments.every((line, index) => line.length === segments[index]?.length);
    const sameDetail = !!previous && previous.detailToken === detailToken && sameShape;
    const lockedHidden = sameDetail ? previous!.lockedHidden.map(indices => [...indices]) : segments.map(() => [] as number[]);
    const lockedControls = sameDetail ? previous!.lockedControls.map(indices => [...indices]) : segments.map(() => [] as number[]);
    if (sameDetail && previous!.segments !== segments) {
      segments.forEach((line, lineIndex) => {
        const oldLine = previous!.segments[lineIndex], shown = new Set(previous!.handleIndices[lineIndex] ?? []);
        const prior = [...shown].sort((a, b) => a - b), hidden = new Set(lockedHidden[lineIndex]), controls = new Set(lockedControls[lineIndex]);
        const changed: number[] = [];
        line.forEach((point, index) => { if (keyOf(point) !== keyOf(oldLine[index])) changed.push(index); });
        const intervals: [number, number][] = [];
        let cursor = 0;
        for (const index of changed) {
          while (cursor < prior.length && prior[cursor] < index) cursor++;
          if (shown.has(index)) controls.add(index);
          const before = cursor > 0 ? prior[cursor - 1] : undefined;
          const after = prior[cursor] === index ? prior[cursor + 1] : prior[cursor];
          if (before !== undefined && after !== undefined) intervals.push([before + 1, after - 1]);
          else if (!shown.has(index)) hidden.add(index);
        }
        intervals.sort((a, b) => a[0] - b[0]);
        let merged: [number, number][] = [];
        for (const interval of intervals) {
          const last = merged.at(-1);
          if (last && interval[0] <= last[1] + 1) last[1] = Math.max(last[1], interval[1]);
          else merged.push([...interval]);
        }
        for (const [start, end] of merged) for (let index = start; index <= end; index++) if (!shown.has(index)) hidden.add(index);
        lockedHidden[lineIndex] = [...hidden].sort((a, b) => a - b);
        lockedControls[lineIndex] = [...controls].sort((a, b) => a - b);
      });
    }
    const preserveLayout = expanded && validViewport && !!viewport && sameDetail && previous!.viewportKey === viewportKey &&
      previous!.epoch === epoch && (moving || previous!.segments !== segments);
    if (preserveLayout) {
      const positions = new Map<string, Coordinate>();
      const inside = (point: Coordinate, padded = true) => {
        const screen = project(point), pad = padded ? 24 : 0;
        return Number.isFinite(screen.x) && Number.isFinite(screen.y) && screen.x >= -pad && screen.x <= viewport!.width + pad && screen.y >= -pad && screen.y <= viewport!.height + pad;
      };
      const handleIndices = segments.map(() => [] as number[]);
      segments.forEach((line, lineIndex) => {
        const frozen = new Set([...(previous!.handleIndices[lineIndex] ?? []), ...(lockedControls[lineIndex] ?? [])]);
        for (const index of frozen) {
          const point = line[index];
          if (point && inside(point)) { positions.set(keyOf(point), point); handleIndices[lineIndex].push(index); }
        }
      });
      const boundaries = new Map<string, Coordinate>(), boundaryIndices = segments.map(() => [] as number[]);
      segments.forEach((line, lineIndex) => {
        for (const index of previous!.boundaryIndices[lineIndex] ?? []) {
          const point = line[index];
          if (point && !inside(point, false)) { boundaries.set(keyOf(point), point); boundaryIndices[lineIndex].push(index); }
        }
      });
      const topology = this.buildTopologyFromSegments(segments);
      if (expanded) for (const [key, point] of topology) {
        if (inside(point)) positions.set(key, point);
      }
      const result = [...positions.values()], boundaryPoints = [...boundaries.values()];
      this.routes.set(trackId, {
        ...previous!, segments, explicit, expanded, epoch, segmentEntries: [], positions: result, boundaries: boundaryPoints,
        handleIndices, boundaryIndices, topologySignature,
        topology,
        detailToken, lockedHidden, lockedControls,
      });
      return result.slice();
    }

    const oldBySegment = new Map<Coordinate[], SegmentEntry>();
    for (const entry of previous?.segmentEntries ?? []) oldBySegment.set(entry.segment, entry);
    const screenCache = new Map<string, ScreenPoint>();
    const screenOf = (point: Coordinate) => {
      if (!validViewport) return project(point);
      const key = keyOf(point), old = screenCache.get(key);
      if (old) return old;
      const screen = project(point); screenCache.set(key, screen); return screen;
    };
    const segmentEntries = segments.map((segment) => {
      const old = oldBySegment.get(segment);
      if (old) {
        if (expanded && (moving || old.sampled?.epoch !== epoch || viewportKey)) {
          old.sampled = this.sample(segment, epoch, screenOf, viewport, old.geographic, old.indexByKey);
          old.visible = old.sampled.visible;
        }
        return old;
      }
      const plain = segment.length ? [segment[0], segment.at(-1)!] : [];
      let indexByKey = this.coordinateIndices.get(segment);
      if (!indexByKey) {
        indexByKey = new Map();
        segment.forEach((point, index) => { const key = keyOf(point), list = indexByKey!.get(key); if (list) list.push(index); else indexByKey!.set(key, [index]); });
        this.coordinateIndices.set(segment, indexByKey);
      }
      const entry: SegmentEntry = { segment, keys: new Set(indexByKey.keys()), plain, geographic: new SnapCandidateIndex(segment), indexByKey };
      if (expanded) { entry.sampled = this.sample(segment, epoch, screenOf, viewport, entry.geographic, indexByKey); entry.visible = entry.sampled.visible; }
      return entry;
    });

    // Keep nodeHandles' insertion and overwrite order: explicit nodes first,
    // then each segment's two endpoints, then its accepted interior handles.
    const positions = new Map<string, Coordinate>();
    const topology = previous?.segments === segments ? previous.topology : this.buildTopology(segmentEntries);
    const geoKeys = new Set<string>();
    if (validViewport && viewport) for (const entry of segmentEntries) {
      const marginLng = (viewport.east - viewport.west) * (24 / viewport.width);
      const marginLat = (viewport.north - viewport.south) * (24 / viewport.height);
      for (const point of entry.geographic!.within({ ...viewport,
        west: viewport.west - marginLng, east: viewport.east + marginLng,
        south: Math.max(-90, viewport.south - marginLat), north: Math.min(90, viewport.north + marginLat),
      })) geoKeys.add(keyOf(point));
    }
    const inViewport = (point: Coordinate) => {
      if (!validViewport || !viewport) return true;
      if (!geoKeys.has(keyOf(point))) return false;
      const screen = screenOf(point);
      return Number.isFinite(screen.x) && Number.isFinite(screen.y) && screen.x >= -24 && screen.x <= viewport.width + 24 && screen.y >= -24 && screen.y <= viewport.height + 24;
    };
    const lockedHiddenSets = lockedHidden.map(indices => new Set(indices));
    const suppressed = (point: Coordinate) => segmentEntries.some((entry, lineIndex) =>
      (entry.indexByKey.get(keyOf(point)) ?? []).length > 0 &&
      (entry.indexByKey.get(keyOf(point)) ?? []).every(index => lockedHiddenSets[lineIndex]?.has(index)));
    const visibleExplicit = new Map<string, Coordinate>();
    for (const point of explicit) {
      const key = keyOf(point);
      if (segmentEntries.some((entry) => entry.keys.has(key)) && !suppressed(point) && inViewport(point)) visibleExplicit.set(key, point);
    }
    if (viewportKey) {
      // Junctions are topological controls even when the spacing sampler would skip them.
      for (const [key, point] of topology) if (!visibleExplicit.has(key) && inViewport(point)) positions.set(key, point);
    }
    if (viewportKey && expanded) {
      for (const [key, point] of visibleExplicit) if (topology.has(key)) positions.set(key, point);
      for (const entry of segmentEntries) {
        let previous: ScreenPoint | null = null;
        const candidateKeys = new Set(entry.sampled!.positions.map(keyOf));
        for (const point of entry.segment) {
          const key = keyOf(point);
          if (!visibleExplicit.has(key) || topology.has(key) || !candidateKeys.has(key)) continue;
          const screen = screenOf(point);
          if (!previous || Math.hypot(screen.x - previous.x, screen.y - previous.y) >= 24) {
            positions.set(key, visibleExplicit.get(key)!); previous = screen;
          }
        }
      }
    } else {
      for (const [key, point] of visibleExplicit) positions.set(key, point);
    }
    for (const entry of segmentEntries) {
      for (const point of expanded ? entry.sampled!.positions.filter(point => !suppressed(point)) : entry.plain.filter(point => !suppressed(point) && inViewport(point)))
        positions.set(keyOf(point), point);
    }

    if (sameDetail && expanded) segments.forEach((line, lineIndex) => {
      for (const index of lockedControls[lineIndex] ?? []) {
        const point = line[index];
        if (point && inViewport(point)) positions.set(keyOf(point), point);
      }
    });

    const result = [...positions.values()];
    const boundaries = viewportKey ? this.boundariesFor(segmentEntries) : [];
    const boundaryIndices = this.boundaryIndicesFor(segmentEntries, boundaries);
    const finalPositions = result;
    this.routes.set(trackId, {
      segments, explicit, expanded, epoch, segmentEntries, positions: finalPositions, boundaries, viewportKey, topology,
      handleIndices: this.indicesForEntries(finalPositions, segmentEntries), boundaryIndices, topologySignature,
      detailToken, lockedHidden, lockedControls: sameDetail ? lockedControls : this.indicesFor(result, segments),
    });
    return finalPositions.slice();
  }

  boundaryControls(trackId: string): Coordinate[] {
    return this.routes.get(trackId)?.boundaries?.slice() ?? [];
  }

  retain(trackIds: ReadonlySet<string>) {
    for (const id of this.routes.keys()) if (!trackIds.has(id)) this.routes.delete(id);
  }

  private sample(
    segment: Coordinate[],
    epoch: number,
    project: (point: Coordinate) => ScreenPoint,
    viewport?: SnapViewport | null,
    geographic?: SnapCandidateIndex,
    indexByKey?: Map<string, number[]>,
  ) {
    if (!segment.length) return { epoch, positions: [] as Coordinate[], visible: [] as Coordinate[] };
    if (isValidSnapViewport(viewport)) {
      const marginLng = (viewport.east - viewport.west) * (24 / viewport.width);
      const marginLat = (viewport.north - viewport.south) * (24 / viewport.height);
      const candidates = (geographic ?? new SnapCandidateIndex(segment)).within({
        ...viewport,
        west: viewport.west - marginLng, east: viewport.east + marginLng,
        south: Math.max(-90, viewport.south - marginLat), north: Math.min(90, viewport.north + marginLat),
      });
      const candidateKeys = new Set(candidates.map(keyOf));
      const positions: Coordinate[] = [], visible: Coordinate[] = [];
      let previous: ScreenPoint | null = null;
      const candidateIndices = [...candidateKeys].flatMap(key => indexByKey?.get(key) ?? []).sort((a,b) => a-b);
      for (const index of candidateIndices) {
        const point = segment[index];
        const screen = project(point);
        if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y) || screen.x < -24 || screen.x > viewport.width + 24 || screen.y < -24 || screen.y > viewport.height + 24) continue;
        visible.push(point);
        if (index === 0 || index === segment.length - 1) { positions.push(point); previous = screen; continue; }
        if (!previous || Math.hypot(screen.x - previous.x, screen.y - previous.y) >= 24) { positions.push(point); previous = screen; }
      }
      return { epoch, positions, visible };
    }
    let previous = project(segment[0]);
    const positions = [segment[0], segment.at(-1)!];
    for (let index = 1; index < segment.length - 1; index++) {
      const point = segment[index];
      const screen = project(point);
      if (Math.hypot(screen.x - previous.x, screen.y - previous.y) >= 24) {
        positions.push(point);
        previous = screen;
      }
    }
    return { epoch, positions, visible: segment.slice() };
  }

  private buildTopology(entries: SegmentEntry[]) {
    const counts = new Map<string, number>(), points = new Map<string, Coordinate>();
    for (const entry of entries) {
      if (entry.segment.length) { points.set(keyOf(entry.segment[0]), entry.segment[0]); points.set(keyOf(entry.segment.at(-1)!), entry.segment.at(-1)!); }
      let previousKey: string | undefined;
      for (const point of entry.segment) {
        const key = keyOf(point); points.set(key, point);
        if (key !== previousKey) counts.set(key, (counts.get(key) ?? 0) + 1);
        previousKey = key;
      }
    }
    const topology = new Map<string, Coordinate>();
    for (const [key, count] of counts) if (count > 1) topology.set(key, points.get(key)!);
    for (const entry of entries) if (entry.segment.length) {
      topology.set(keyOf(entry.segment[0]), entry.segment[0]);
      topology.set(keyOf(entry.segment.at(-1)!), entry.segment.at(-1)!);
    }
    return topology;
  }

  private boundariesFor(entries: SegmentEntry[]) {
    const result = new Map<string, Coordinate>();
    for (const entry of entries) {
      const visible = new Set((entry.visible ?? []).map(keyOf));
      const indices = [...visible].flatMap(key => entry.indexByKey.get(key) ?? []).sort((a,b) => a-b);
      if (!indices.length) continue;
      const runs: [number, number][] = [];
      let start = indices[0], end = start;
      for (const index of indices.slice(1)) { if (index === end + 1) end = index; else { runs.push([start,end]); start=end=index; } }
      runs.push([start,end]);
      for (const [first,last] of runs) for (const index of [first-1,last+1]) {
        const point = entry.segment[index];
        if (point && !visible.has(keyOf(point))) result.set(keyOf(point), point);
      }
    }
    return [...result.values()];
  }

  private boundaryIndicesFor(entries: SegmentEntry[], boundaries: Coordinate[]) {
    const keys = new Set(boundaries.map(keyOf));
    return entries.map(entry => entry.segment.flatMap((point, index) => keys.has(keyOf(point)) ? [index] : []));
  }

  private indicesFor(points: Coordinate[], segments: Coordinate[][]) {
    const keys = new Set(points.map(keyOf));
    return segments.map(line => line.flatMap((point, index) => keys.has(keyOf(point)) ? [index] : []));
  }

  private indicesForEntries(points: Coordinate[], entries: SegmentEntry[]) {
    const keys = new Set(points.map(keyOf));
    return entries.map(entry => [...keys].flatMap(key => entry.indexByKey.get(key) ?? []).sort((a, b) => a - b));
  }

  private topologySignature(segments: Coordinate[][]) {
    const locations = new Map<string, string[]>();
    segments.forEach((line, lineIndex) => {
      let previousKey: string | undefined;
      line.forEach((point, index) => {
        const key = keyOf(point);
        if (key !== previousKey) {
          const at = locations.get(key);
          if (at) at.push(`${lineIndex}:${index}`); else locations.set(key, [`${lineIndex}:${index}`]);
        }
        previousKey = key;
      });
    });
    return [...locations.values()].filter(at => at.length > 1).map(at => at.join(',')).sort().join(';');
  }

  private buildTopologyFromSegments(segments: Coordinate[][]) {
    const counts = new Map<string, number>(), points = new Map<string, Coordinate>();
    for (const line of segments) {
      if (line.length) { points.set(keyOf(line[0]), line[0]); points.set(keyOf(line.at(-1)!), line.at(-1)!); }
      let previousKey: string | undefined;
      for (const point of line) {
        const key = keyOf(point); points.set(key, point);
        if (key !== previousKey) counts.set(key, (counts.get(key) ?? 0) + 1);
        previousKey = key;
      }
    }
    const topology = new Map<string, Coordinate>();
    for (const [key, count] of counts) if (count > 1) topology.set(key, points.get(key)!);
    for (const line of segments) if (line.length) {
      topology.set(keyOf(line[0]), line[0]); topology.set(keyOf(line.at(-1)!), line.at(-1)!);
    }
    return topology;
  }
}
