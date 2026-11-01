import type { Coordinate } from '../../navigation/types.ts';
import type { RoadLine, RoadMatch, RoadProject } from '../../tracks/roadSnapping.ts';

export type NativeRoadSnapKind = 'road' | 'river';

export type NativeRoadSnapAnchorState = {
  readonly kind: NativeRoadSnapKind | null;
  readonly generation: number | null;
  readonly anchor: RoadMatch | null;
  readonly lastCandidate: RoadMatch | null;
};

export type NativeRoadSnapAnchorResolution = {
  readonly state: NativeRoadSnapAnchorState;
  /** An explicit stroke match always wins; otherwise this is the committed points anchor. */
  readonly previous: RoadMatch | null;
  /** Rebound start on the current source snapshot, or null when normal nearest-from fallback is needed. */
  readonly start: RoadMatch | null;
  readonly trackCandidate: boolean;
};

type SegmentSignature = {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly level: number;
};

// Matches are short-lived; weak keys keep only endpoint scalars while a caller retains a match.
const segmentSignatures = new WeakMap<RoadMatch, SegmentSignature>();

export function emptyNativeRoadSnapAnchorState(): NativeRoadSnapAnchorState {
  return { kind: null, generation: null, anchor: null, lastCandidate: null };
}

/** Resolve a committed points anchor. Only exact committed coordinates can promote an aim candidate. */
export function resolveNativeRoadSnapAnchor(
  input: NativeRoadSnapAnchorState,
  kind: NativeRoadSnapKind,
  generation: number,
  from: Coordinate | undefined,
  explicitPrevious: RoadMatch | null,
  linesById: ReadonlyMap<string, RoadLine>,
  project: RoadProject,
  projectionValid: boolean,
): NativeRoadSnapAnchorResolution {
  const matchingState = input.kind === kind && input.generation === generation;
  const base = matchingState ? input : emptyNativeRoadSnapAnchorState();

  // Freehand passes its own in-progress match. Preserve that behavior and don't mix it with points state.
  if (explicitPrevious) {
    rememberSegmentSignature(explicitPrevious);
    const start = projectionValid && from
      ? rebindMatch(explicitPrevious, from, linesById, project)
      : null;
    return {
      state: emptyNativeRoadSnapAnchorState(),
      previous: explicitPrevious,
      start,
      trackCandidate: false,
    };
  }

  if (!projectionValid) {
    return {
      state: emptyNativeRoadSnapAnchorState(),
      previous: null,
      start: null,
      trackCandidate: false,
    };
  }
  if (from === undefined) {
    return {
      state: { kind, generation, anchor: null, lastCandidate: null },
      previous: null,
      start: null,
      trackCandidate: true,
    };
  }
  if (!validCoordinate(from)) {
    return {
      state: emptyNativeRoadSnapAnchorState(),
      previous: null,
      start: null,
      trackCandidate: false,
    };
  }

  let anchor: RoadMatch | null = null;
  if (base.anchor && sameCoordinate(base.anchor.coordinate, from)) {
    anchor = rebindMatch(base.anchor, from, linesById, project);
  } else if (base.lastCandidate && sameCoordinate(base.lastCandidate.coordinate, from)) {
    // A candidate becomes an anchor only when the committed from point exactly equals it.
    anchor = rebindMatch(base.lastCandidate, from, linesById, project);
  }

  const state: NativeRoadSnapAnchorState = anchor
    ? { kind, generation, anchor, lastCandidate: null }
    : { kind, generation, anchor: null, lastCandidate: null };
  return { state, previous: anchor, start: anchor, trackCandidate: true };
}

/** Remember this aim's match separately; an uncommitted aim never replaces the anchor. */
export function rememberNativeRoadSnapCandidate(
  state: NativeRoadSnapAnchorState,
  kind: NativeRoadSnapKind,
  generation: number,
  match: RoadMatch | null,
  trackCandidate: boolean,
): NativeRoadSnapAnchorState {
  if (!trackCandidate) return emptyNativeRoadSnapAnchorState();
  if (match) rememberSegmentSignature(match);
  const base = state.kind === kind && state.generation === generation
    ? state
    : { ...emptyNativeRoadSnapAnchorState(), kind, generation };
  return { ...base, lastCandidate: match };
}

/** Exact source segment identity plus a fresh projection are required to carry a match forward. */
function rebindMatch(
  match: RoadMatch,
  from: Coordinate,
  linesById: ReadonlyMap<string, RoadLine>,
  project: RoadProject,
): RoadMatch | null {
  if (!validCoordinate(from) || !sameCoordinate(match.coordinate, from)) return null;
  if (!Number.isInteger(match.index) || !Number.isFinite(match.fraction) || match.fraction < 0 || match.fraction > 1) return null;
  const line = linesById.get(match.line.id);
  if (!line) return null;
  const signature = segmentSignatures.get(match);
  if (!signature) return null;
  const newA = line.coordinates[match.index], newB = line.coordinates[match.index + 1];
  if (!validCoordinate(newA) || !validCoordinate(newB) ||
    signature.ax !== newA[0] || signature.ay !== newA[1] || signature.bx !== newB[0] || signature.by !== newB[1] ||
    signature.level !== (line.level ?? 0)) return null;
  const screen = project(from);
  if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return null;
  const rebound = { ...match, line, coordinate: from, screen };
  segmentSignatures.set(rebound, signature);
  return rebound;
}

function readSegmentSignature(match: RoadMatch): SegmentSignature | null {
  if (!Number.isInteger(match.index) || !Number.isFinite(match.fraction) || match.fraction < 0 || match.fraction > 1) return null;
  const a = match.line.coordinates[match.index], b = match.line.coordinates[match.index + 1];
  if (!validCoordinate(a) || !validCoordinate(b)) return null;
  const level = match.line.level ?? 0;
  if (!Number.isFinite(level)) return null;
  return { ax: a[0], ay: a[1], bx: b[0], by: b[1], level };
}

function rememberSegmentSignature(match: RoadMatch): void {
  if (segmentSignatures.has(match)) return;
  const signature = readSegmentSignature(match);
  if (signature) segmentSignatures.set(match, signature);
}

function validCoordinate(value: Coordinate | undefined): value is Coordinate {
  return !!value && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function sameCoordinate(a: Coordinate, b: Coordinate): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
