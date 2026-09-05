import type { Map } from 'maplibre-gl';
import {
  nearestRoad,
  roadLines,
  ROAD_RELEASE_RADIUS,
  type RoadMatch,
  type RoadSnapResult,
} from '../tracks/roadSnapping';
import type { ScreenPoint } from '../tracks/drawing';

/** Adapt only currently rendered road vectors; no per-touch network requests. */
export function snapMapRoad(
  map: Map | null,
  point: ScreenPoint,
  previous: RoadMatch | null,
  roadsVisible: boolean,
): RoadSnapResult {
  if (!map) return { status: 'loading', match: null };
  if (!roadsVisible) return { status: 'hidden', match: null };
  if (map.getZoom() < 12) return { status: 'zoom', match: null };
  if (!map.getSource('openmaptiles'))
    return { status: 'unavailable', match: null };
  const layers = ['main-roads', 'local-roads'].filter((id) => map.getLayer(id));
  if (!layers.length) return { status: 'unavailable', match: null };
  try {
    const radius = ROAD_RELEASE_RADIUS;
    const features = map.queryRenderedFeatures(
      [
        [point.x - radius, point.y - radius],
        [point.x + radius, point.y + radius],
      ],
      { layers },
    );
    const match = nearestRoad(
      point,
      roadLines(features),
      (coordinate) => map.project(coordinate),
      previous,
    );
    return {
      status: match || map.isSourceLoaded('openmaptiles') ? 'ready' : 'loading',
      match,
    };
  } catch {
    return { status: 'unavailable', match: null };
  }
}
