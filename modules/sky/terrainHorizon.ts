import type { ElevationSample, JourneySample } from '../journey/metrics';

export interface TerrainObserver {
  lng: number;
  lat: number;
  altitudeMeters?: number | null;
  groundElevationMeters?: number | null;
  eyeHeightMeters?: number;
}

export interface TerrainDirection {
  azimuthDeg: number;
  altitudeDeg: number | null;
  distanceMeters: number | null;
  elevationMeters: number | null;
  coverage?: number;
  nearAltitudeDeg?: number | null;
  midAltitudeDeg?: number | null;
}

export interface TerrainHorizon {
  status: 'complete' | 'partial' | 'unavailable';
  observerAltitudeMeters: number | null;
  coverage: number;
  directions: readonly TerrainDirection[];
}

type ProfileReader = (samples: JourneySample[], signal: AbortSignal) => Promise<ElevationSample[]>;

const RADIUS = 6_371_008.8;
const RAD = Math.PI / 180;
const DIRECTION_COUNT = 360;
const MAX_DISTANCE = 55_000;
const profileCache = new Map<string, TerrainHorizon>();
interface TerrainSurvey {
  readonly expectedSamples: number;
  readonly measurements: Float64Array;
}
const terrainSurveys = new WeakMap<TerrainHorizon, TerrainSurvey>();

function longitude(lng: number): number {
  return ((lng % 360 + 540) % 360) - 180;
}

function pointAt(lng: number, lat: number, bearing: number, distance: number): [number, number] {
  const phi = lat * RAD;
  const angle = distance / RADIUS;
  const angleCos = Math.cos(angle);
  const angleSin = Math.sin(angle);
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const lat2 = Math.asin(sinPhi * angleCos + cosPhi * angleSin * Math.cos(bearing));
  const lng2 = Math.atan2(Math.sin(bearing) * angleSin * cosPhi, angleCos - sinPhi * Math.sin(lat2));
  return [longitude(lng + lng2 / RAD), lat2 / RAD];
}

function isHeight(height: number | null | undefined): height is number {
  return height != null && Number.isFinite(height);
}

function emptyDirection(azimuthDeg: number): TerrainDirection {
  return { azimuthDeg, altitudeDeg: null, distanceMeters: null, elevationMeters: null };
}

/** A bounded radial DEM survey. Distances and elevation angles use metres and true north. */
export async function sampleTerrainHorizon(
  observer: TerrainObserver,
  signal: AbortSignal,
  read: ProfileReader,
): Promise<TerrainHorizon> {
  signal.throwIfAborted();
  const directions = Array.from({ length: DIRECTION_COUNT }, (_, i) => emptyDirection(i));
  const { lat, altitudeMeters, groundElevationMeters } = observer;
  const lng = longitude(observer.lng);
  const eye = isHeight(observer.eyeHeightMeters) ? Math.max(0, observer.eyeHeightMeters) : 1.7;
  const knownAltitude = isHeight(altitudeMeters)
    ? altitudeMeters
    : isHeight(groundElevationMeters) ? groundElevationMeters + eye : null;
  const unavailable: TerrainHorizon = {
    status: 'unavailable', observerAltitudeMeters: knownAltitude, coverage: 0, directions,
  };
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 85) return unavailable;

  const positions: JourneySample[] = [{ coordinates: [lng, lat], distance: 0, part: -1 }];
  let expectedSamples = 0;
  for (let distance = 45; ; distance = Math.min(MAX_DISTANCE, distance + Math.max(40, distance * 0.13))) {
    expectedSamples += DIRECTION_COUNT;
    for (let azimuth = 0; azimuth < DIRECTION_COUNT; azimuth++) {
      const coordinates = pointAt(lng, lat, azimuth * RAD, distance);
      if (Math.abs(coordinates[1]) <= 85) positions.push({ coordinates, distance, part: azimuth });
    }
    if (distance === MAX_DISTANCE) break;
  }

  const samples = await read(positions, signal);
  signal.throwIfAborted();
  const ground = samples[0]?.elevation;
  const altitude = knownAltitude ?? (isHeight(ground) ? ground + eye : null);
  const measurements = new Float64Array(Math.max(0, samples.length - 1) * 3);
  let count = 0;
  for (const { distance, part, elevation } of samples) {
    if (part < 0 || !isHeight(elevation)) continue;
    measurements[count++] = distance;
    measurements[count++] = part;
    measurements[count++] = elevation;
  }
  const survey = { expectedSamples, measurements: measurements.subarray(0, count) };
  const horizon = altitude === null ? unavailable : projectSurvey(survey, altitude, directions);
  terrainSurveys.set(horizon, survey);
  return horizon;
}

function projectSurvey(
  { expectedSamples, measurements }: TerrainSurvey,
  altitude: number,
  directions = Array.from({ length: DIRECTION_COUNT }, (_, i) => emptyDirection(i)),
): TerrainHorizon {
  const availablePerDirection = new Uint16Array(DIRECTION_COUNT);
  const near = new Float64Array(DIRECTION_COUNT).fill(-Infinity);
  const mid = new Float64Array(DIRECTION_COUNT).fill(-Infinity);
  for (let offset = 0; offset < measurements.length; offset += 3) {
    const distance = measurements[offset];
    const part = measurements[offset + 1];
    const elevation = measurements[offset + 2];
    availablePerDirection[part]++;
    // Project the terrain point onto the observer's local horizontal frame.
    const angle = distance / RADIUS;
    const horizontal = (RADIUS + elevation) * Math.sin(angle);
    const vertical = elevation - altitude - 2 * (RADIUS + elevation) * Math.sin(angle / 2) ** 2;
    const altitudeDeg = Math.atan2(vertical, horizontal) / RAD;
    if (distance <= 1_000) near[part] = Math.max(near[part], altitudeDeg);
    if (distance <= 6_000) mid[part] = Math.max(mid[part], altitudeDeg);
    const direction = directions[part];
    if (direction.altitudeDeg === null || altitudeDeg > direction.altitudeDeg) {
      directions[part] = { azimuthDeg: part, altitudeDeg, distanceMeters: distance, elevationMeters: elevation };
    }
  }

  const expectedPerDirection = expectedSamples / DIRECTION_COUNT;
  directions.forEach((direction, i) => {
    direction.coverage = availablePerDirection[i] / expectedPerDirection;
    direction.nearAltitudeDeg = Number.isFinite(near[i]) ? near[i] : null;
    direction.midAltitudeDeg = Number.isFinite(mid[i]) ? mid[i] : null;
  });
  const coverage = measurements.length / 3 / expectedSamples;
  return {
    status: coverage === 1 ? 'complete' : coverage > 0 ? 'partial' : 'unavailable',
    observerAltitudeMeters: altitude,
    coverage,
    directions,
  };
}

/** Reuse the same surveyed DEM samples, including when a different peak becomes the skyline. */
export function terrainHorizonAtAltitude(horizon: TerrainHorizon, altitude: number): TerrainHorizon {
  if (!Number.isFinite(altitude) || altitude === horizon.observerAltitudeMeters) return horizon;
  const survey = terrainSurveys.get(horizon);
  if (!survey) return horizon;
  const adjusted = projectSurvey(survey, altitude);
  terrainSurveys.set(adjusted, survey);
  return adjusted;
}

/** Build once per observer. The request contains no time or calendar state. */
export async function loadTerrainHorizon(observer: TerrainObserver, signal: AbortSignal): Promise<TerrainHorizon> {
  signal.throwIfAborted();
  const key = JSON.stringify([
    longitude(observer.lng), observer.lat, observer.altitudeMeters,
    observer.groundElevationMeters, observer.eyeHeightMeters,
  ]);
  const { readHorizonProfile, offlineMapOnly } = await import('./terrainHorizonDem');
  const offline = offlineMapOnly();
  signal.throwIfAborted();
  const cached = offline ? undefined : profileCache.get(key);
  if (cached) return cached;

  const result = await sampleTerrainHorizon(observer, signal, readHorizonProfile);
  if (!offline && result.status === 'complete') {
    if (profileCache.size >= 8) profileCache.delete(profileCache.keys().next().value!);
    profileCache.set(key, result);
  }
  return result;
}

export function terrainHorizonAt(horizon: TerrainHorizon, azimuthDeg: number): number | null {
  if (!Number.isFinite(azimuthDeg)) return null;
  const angle = ((azimuthDeg % 360) + 360) % 360;
  const firstIndex = Math.floor(angle);
  const knownAltitude = (direction: TerrainDirection | undefined) =>
    direction && (direction.coverage ?? horizon.coverage) === 1 ? direction.altitudeDeg : null;
  const first = knownAltitude(horizon.directions[firstIndex]);
  if (angle === firstIndex || first === null) return first;
  const next = knownAltitude(horizon.directions[(firstIndex + 1) % 360]);
  return next === null ? null : first + (next - first) * (angle - firstIndex);
}
