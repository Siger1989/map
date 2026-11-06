import type { Coordinate } from '../navigation/types.ts';
import type { MapSource } from '../mapSources/types.ts';
import type { TripPackage } from './offline.ts';
import type { DownloadArea } from './downloadPlan.ts';

export function createImportedPlanningTrip(
  id: string,
  name: string,
  area: Extract<DownloadArea, { kind: 'route' }>,
  source: MapSource,
  zoom: number,
  routeNames: readonly string[] | undefined,
  createdAt = Date.now(),
): TripPackage {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const segment of area.segments) for (const point of segment) {
    if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    west = Math.min(west, point[0]); south = Math.min(south, point[1]);
    east = Math.max(east, point[0]); north = Math.max(north, point[1]);
  }
  const bounds: TripPackage['bounds'] = Number.isFinite(west) ? [west, south, east, north] : [0, 0, 0, 0];
  return {
    id,
    name: `${name.trim().slice(0, 30) || '路线'} · ${source.name}`.slice(0, 60),
    bounds,
    urls: [],
    done: 0,
    bytes: 0,
    createdAt,
    complete: false,
    provider: 'imported',
    sourceId: source.id,
    sourceName: source.name,
    datum: source.datum ?? 'wgs84',
    zoom,
    bufferKm: area.bufferKm,
    routeNames: routeNames ? [...routeNames] : [name],
    routeSegments: area.segments.map((segment) => segment.map((point) => [...point] as Coordinate)),
    phase: 'preparing',
    phaseMessage: '正在规划路线缓存…',
  };
}

export function importedTaskPhase(state?: string): TripPackage['phase'] {
  if (state === 'complete') return 'complete';
  if (state === 'paused' || state === 'cancelled') return 'paused';
  if (state === 'error') return 'failed';
  if (state === 'waiting') return 'waiting';
  if (['queued', 'running', 'downloading'].includes(state ?? '')) return 'running';
  return undefined;
}

