import type { Map } from 'maplibre-gl';
import {
  nearestRoad,
  roadLines,
  ROAD_RELEASE_RADIUS,
  type RoadMatch,
  type RoadSnapResult,
} from '../tracks/roadSnapping';
import type { ScreenPoint } from '../tracks/drawing';
import type { Coordinate } from '../navigation/types';
import { roadPath } from '../tracks/roadPath';
import type { RoadLine } from '../tracks/roadSnapping';

const networkCache = new WeakMap<
  Map,
  { key: string; expires: number; lines: RoadLine[] }
>();

/** Adapt only currently rendered road vectors; no per-touch network requests. */
export function snapMapRoad(
  map: Map | null,
  point: ScreenPoint,
  previous: RoadMatch | null,
  roadsVisible: boolean,
  from?: Coordinate,
): RoadSnapResult {
  if (!map) return { status: 'loading', match: null };
  if (!roadsVisible) return { status: 'hidden', match: null };
  // Use visible road geometry at any scale, including main roads below zoom 12.
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
    let section: Coordinate[] | null | undefined;
    if (from && match) {
      section = null;
      const startScreen = map.project(from);
      const start = nearestRoad(
        startScreen,
        roadLines(
          map.queryRenderedFeatures(
            [
              [startScreen.x - radius, startScreen.y - radius],
              [startScreen.x + radius, startScreen.y + radius],
            ],
            { layers },
          ),
        ),
        (coordinate) => map.project(coordinate),
      );
      if (start) {
        const center = map.getCenter();
        const key = [
          center.lng,
          center.lat,
          map.getZoom(),
          map.getBearing(),
          map.getPitch(),
        ].join(',');
        let cached = networkCache.get(map);
        if (!cached || cached.key !== key || cached.expires < Date.now()) {
          cached = {
            key,
            expires: Date.now() + 300,
            lines: roadLines(map.queryRenderedFeatures(undefined, { layers })),
          };
          networkCache.set(map, cached);
        }
        section = roadPath(start, match, cached.lines);
      }
    }
    return {
      status: match || map.isSourceLoaded('openmaptiles') ? 'ready' : 'loading',
      match,
      section,
    };
  } catch {
    return { status: 'unavailable', match: null };
  }
}
