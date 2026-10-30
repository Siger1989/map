import type { Annotation } from '../../annotations/data.ts';
import type { AreaOverlay } from '../../areas/AreaLayer.ts';
import type { Coordinate } from '../../navigation/types.ts';
import type { VisiblePhoto } from '../../photos/storage.ts';
import type { SectionObject } from '../../section/sectionObjects.ts';
import type { TrackOverlay } from '../../tracks/TrackLayer.ts';
import type { RouteOverlay } from '../../navigation/types.ts';
import { DRAFT_ID } from '../../tracks/editing.ts';
import type { TrackNode } from '../../tracks/editing.ts';
import { pickLinePoint, type TrackLinePoint } from '../../tracks/linePoint.ts';
import type { ScreenPoint } from '../../tracks/drawing.ts';
import { pickNearestVisibleLine } from './lineHitTest.ts';

export type NativeTapPick = {
  point: ScreenPoint;
  coordinate: Coordinate | null;
  ids: string[];
  gestureId?: string | number;
  eventTime?: number;
};

export type NativeTapAction =
  | { type: 'none' }
  | { type: 'mapPick'; coordinate: Coordinate; queryPoint: boolean }
  | { type: 'annotation'; id: string }
  | { type: 'annotationNavigate'; id: string; slot: 'start' | 'end' }
  | { type: 'photo'; ids: string[] }
  | { type: 'area'; id: string }
  | { type: 'track'; id: string }
  | { type: 'trackNode'; node: TrackNode }
  | { type: 'trackLine'; point: TrackLinePoint }
  | { type: 'route' }
  | { type: 'section'; id?: string };

export type NativeTapState = {
  readOnly?: boolean;
  drawingActive: boolean;
  clickBlocked: boolean;
  queryOnPick?: boolean;
  pickingActive: boolean;
  annotationPicking?: boolean;
  measurementPicking?: boolean;
  sectionEditing: boolean;
  sectionEnabled: boolean;
  sectionItems: SectionObject[];
  annotations: Annotation[];
  photos: VisiblePhoto[];
  photoGroups?: Array<{ photo: VisiblePhoto; groupIds: string[] }>;
  areaOverlay: AreaOverlay;
  trackOverlay: TrackOverlay;
  routeOverlay?: RouteOverlay;
};

type PickMetadata = Record<string, unknown>;
function metadata(ids: string[]): PickMetadata[] {
  const values: PickMetadata[] = [];
  for (const id of ids) {
    if (!id.startsWith('shantu-bridge:')) continue;
    try {
      const parsed: unknown = JSON.parse(id.slice('shantu-bridge:'.length));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) values.push(parsed as PickMetadata);
    } catch { /* Ignore malformed native delegates; remaining IDs are still usable. */ }
  }
  return values;
}

function objectId(id: string): string {
  return id.startsWith('shantu-object:') ? id.slice('shantu-object:'.length) : id;
}

function readCoordinate(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length < 2 || !value.slice(0, 2).every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const [longitude, latitude] = value as number[];
  if (longitude! < -180 || longitude! > 180 || latitude! < -90 || latitude! > 90) return null;
  return [longitude!, latitude!];
}

function hitAnnotation(ids: string[], annotations: Annotation[]): Annotation | null {
  const values = metadata(ids);
  const annotationId = values.find((value) => ['annotation', 'pin', 'model'].includes(String(value.kind)))?.id;
  const candidates = new Set(ids.map(objectId));
  if (typeof annotationId === 'string') candidates.add(annotationId);
  return annotations.find((item) => item.visible && candidates.has(item.id)) ?? null;
}

function hitTrackNode(ids: string[]): TrackNode | null {
  for (const value of metadata(ids)) {
    if (value.kind !== 'trackNode' || typeof value.trackId !== 'string') continue;
    const coordinate = readCoordinate(value.coordinate);
    if (coordinate) return { trackId: value.trackId, coordinate };
  }
  return null;
}

function hitTrackIds(ids: string[], tracks: TrackOverlay): string[] {
  if (!tracks.visible) return [];
  const found = new Set<string>();
  for (const value of metadata(ids)) {
    if (value.kind === 'track' && typeof value.trackId === 'string') found.add(value.trackId);
    if (value.kind === 'trackNode' && typeof value.trackId === 'string') found.add(value.trackId);
  }
  for (const raw of ids) {
    const id = objectId(raw);
    if (id.startsWith('track:')) found.add(id.slice('track:'.length).split(':')[0]!);
    const match = tracks.saved.find((track) => track.id === id);
    if (match) found.add(match.id);
  }
  if (ids.some((id) => id === 'shantu-bridge:{"kind":"track","trackId":"__draft"}')) found.add(DRAFT_ID);
  return [...found].filter((id) => id === DRAFT_ID
    ? (tracks.style?.opacity ?? 1) > 0
    : tracks.saved.some((track) => track.id === id && !track.hidden && (track.style?.opacity ?? 1) > 0));
}

function linePick(trackId: string, tracks: TrackOverlay, point: ScreenPoint, project: (coordinate: Coordinate) => ScreenPoint | null): TrackLinePoint | null {
  if (!tracks.visible || (trackId === DRAFT_ID && (tracks.style?.opacity ?? 1) <= 0)) return null;
  const segments = trackId === DRAFT_ID ? tracks.draft : tracks.saved.find((track) => track.id === trackId)?.segments;
  if (trackId !== DRAFT_ID) {
    const track = tracks.saved.find((item) => item.id === trackId);
    if (!track || track.hidden || (track.style?.opacity ?? 1) <= 0) return null;
  }
  if (!segments) return null;
  return pickLinePoint(trackId, segments, point, (coordinate) => project(coordinate) ?? { x: Number.NaN, y: Number.NaN });
}

function areaNodePick(state: AreaOverlay, point: ScreenPoint, project: (coordinate: Coordinate) => ScreenPoint | null): Coordinate | null {
  const area = state.items.find((item) => item.id === state.selected && item.visible);
  if (!area) return null;
  const points = area.boundary.map((coordinate, index) => state.preview?.id === area.id &&
    (index === state.preview.index || (state.preview.index === 0 && index === area.boundary.length - 1))
    ? state.preview.coordinate : coordinate);
  const open = points.length > 1 && points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1] ? points.slice(0, -1) : points;
  let closest: { coordinate: Coordinate; distance: number } | null = null;
  for (let index = 0; index < open.length; index++) {
    if (index > 0) {
      const previous = project(open[index - 1]!);
      const current = project(open[index]!);
      if (previous && current && Math.hypot(previous.x - current.x, previous.y - current.y) < 16) continue;
    }
    const screen = project(open[index]!);
    if (!screen) continue;
    const distance = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (distance <= 14 && (!closest || distance < closest.distance)) closest = { coordinate: open[index]!, distance };
  }
  return closest?.coordinate ?? null;
}

function hitRoute(ids: string[], route?: RouteOverlay): boolean {
  if (route && (!route.route || (route.route.displayOpacity ?? 1) <= 0)) return false;
  if (metadata(ids).some((value) => value.kind === 'route')) return true;
  return ids.some((raw) => {
    const id = objectId(raw);
    return id === '__planned-route' || id.startsWith('__route-display-') || id.startsWith('route:');
  });
}

function hitArea(ids: string[], areas: AreaOverlay): string | null {
  for (const raw of ids) {
    const id = objectId(raw);
    if (areas.items.some((area) => area.id === id && area.visible)) return id;
  }
  return null;
}

function hitPhoto(ids: string[], photos: VisiblePhoto[], groups?: NativeTapState['photoGroups']): string[] | null {
  for (const raw of ids) {
    const id = raw.startsWith('shantu-photo:') ? raw.slice('shantu-photo:'.length) : objectId(raw).startsWith('photo:') ? objectId(raw).slice('photo:'.length) : objectId(raw);
    const photo = photos.find((item) => item.id === id);
    if (!photo) continue;
    return groups?.find((group) => group.photo.id === id)?.groupIds ?? [id];
  }
  return null;
}

function savedSectionId(ids: string[], state: NativeTapState): string | undefined | null {
  for (const raw of ids) {
    const id = raw.startsWith('shantu-section:') ? raw.slice('shantu-section:'.length) : '';
    if (id === '__active') return undefined;
    if (id && state.sectionItems.some((item) => item.id === id && item.settings.enabled)) return id;
  }
  return null;
}

function geographicDistanceMeters(a: Coordinate, b: Coordinate): number {
  const radians = Math.PI / 180;
  const latitude = (a[1] + b[1]) * 0.5 * radians;
  const dx = (a[0] - b[0]) * radians * Math.cos(latitude) * 6_371_000;
  const dy = (a[1] - b[1]) * radians * 6_371_000;
  return Math.hypot(dx, dy);
}

/** A screen projection can include lines behind terrain; only use a geometric miss
 * fallback when the native terrain ray also returned a nearby ground coordinate. */
function lineIsNearGround(
  line: TrackLinePoint,
  ground: Coordinate | null,
  project: (coordinate: Coordinate) => ScreenPoint | null,
): boolean {
  if (!ground) return false;
  const latitudeOffset = 1 / 111_320;
  const longitudeOffset = latitudeOffset / Math.max(0.05, Math.cos(ground[1] * Math.PI / 180));
  const center = project(ground);
  const east = project([ground[0] + longitudeOffset, ground[1]]);
  const north = project([ground[0], ground[1] + latitudeOffset]);
  if (!center || !east || !north) return false;
  const pixelsPerMeter = Math.max(Math.hypot(east.x - center.x, east.y - center.y), Math.hypot(north.x - center.x, north.y - center.y));
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 1e-6) return false;
  return geographicDistanceMeters(line.coordinate, ground) <= 14 / pixelsPerMeter;
}

/** Interpret one completed native tap in the same priority order as WebTerrainMap's click handler. */
export function interpretNativeTap(
  tap: NativeTapPick,
  state: NativeTapState,
  project: (coordinate: Coordinate) => ScreenPoint | null,
): NativeTapAction {
  if (state.readOnly || state.drawingActive || state.clickBlocked) return { type: 'none' };
  const ids = tap.ids;
  const annotation = hitAnnotation(ids, state.annotations);
  const node = hitTrackNode(ids);
  const trackIds = hitTrackIds(ids, state.trackOverlay);
  const hasSemanticPick = !!hitPhoto(ids, state.photos, state.photoGroups)
    || !!annotation || !!node || trackIds.length > 0 || hitRoute(ids, state.routeOverlay)
    || !!hitArea(ids, state.areaOverlay)
    || savedSectionId(ids, state) !== null;
  const nearestLine = () => {
    if (hasSemanticPick) return null;
    const candidate = pickNearestVisibleLine(tap.point, state.trackOverlay, state.routeOverlay, project);
    return candidate && lineIsNearGround(candidate.point, tap.coordinate, project) ? candidate : null;
  };
  const bestLine = () => {
    let best: TrackLinePoint | null = null;
    let bestDistance = Infinity;
    for (const id of trackIds) {
      const candidate = linePick(id, state.trackOverlay, tap.point, project);
      if (!candidate) continue;
      const projected = project(candidate.coordinate);
      if (!projected) continue;
      const distance = Math.hypot(projected.x - tap.point.x, projected.y - tap.point.y);
      if (distance < bestDistance) { best = candidate; bestDistance = distance; }
    }
    if (best) return best;
    // Background delegates are not business objects. Preserve exact interactive
    // picks, but let an editing/measurement miss refine a nearby visible track.
    const geometric = hasSemanticPick || (!state.trackOverlay.editing && !state.measurementPicking)
      ? null
      : pickNearestVisibleLine(tap.point, state.trackOverlay, undefined, project);
    if (geometric?.kind === 'track' && lineIsNearGround(geometric.point, tap.coordinate, project)) return geometric.point;
    return best;
  };

  // PhotoLayer uses a DOM button that stops the map's pointer/click event, so its
  // pick callback precedes ordinary map-mode click handling.
  const photo = hitPhoto(ids, state.photos, state.photoGroups);
  if (photo) return { type: 'photo', ids: photo };

  if (state.annotationPicking && annotation) return { type: 'annotation', id: annotation.id };

  if (state.measurementPicking) {
    const coordinate = node?.coordinate ?? areaNodePick(state.areaOverlay, tap.point, project) ?? bestLine()?.coordinate;
    if (coordinate) return { type: 'mapPick', coordinate, queryPoint: false };
  }

  if ((state.sectionEnabled || state.sectionItems.some((item) => item.settings.enabled)) && !state.pickingActive && !state.drawingActive) {
    if (state.sectionEditing && annotation) return { type: 'annotation', id: annotation.id };
    const sectionId = savedSectionId(ids, state);
    if (sectionId !== null && (sectionId !== undefined || ids.some((id) => id === 'shantu-section:__active'))) return { type: 'section', ...(sectionId === undefined ? {} : { id: sectionId }) };
  }

  if (!state.pickingActive) {
    if (state.trackOverlay.editing) {
      if (node) return { type: 'trackNode', node };
      const line = bestLine();
      if (line) return { type: 'trackLine', point: line };
      if (hitRoute(ids, state.routeOverlay)) return { type: 'route' };
      return tap.coordinate ? { type: 'mapPick', coordinate: tap.coordinate, queryPoint: state.queryOnPick !== false } : { type: 'none' };
    }
    if (annotation) return { type: 'annotation', id: annotation.id };
    if (hitRoute(ids, state.routeOverlay)) return { type: 'route' };
    if (node) return { type: 'trackNode', node };
    const trackLine = bestLine();
    if (trackLine) return { type: 'trackLine', point: trackLine };
    const line = nearestLine();
    if (line?.kind === 'route') return { type: 'route' };
    if (line?.kind === 'track') return { type: 'trackLine', point: line.point };
    if (trackIds.length) return { type: 'track', id: trackIds[0]! };
    const area = hitArea(ids, state.areaOverlay);
    if (area) return { type: 'area', id: area };
  }
  return tap.coordinate ? { type: 'mapPick', coordinate: tap.coordinate, queryPoint: state.queryOnPick !== false } : { type: 'none' };
}
