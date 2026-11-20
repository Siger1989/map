import { metresBetween } from '../navigation/types.ts';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera.ts';
import type { JourneyPlaybackFrame, SkyJourneyCoordinate } from './journeyPlayback.ts';

const radiusM = 6_371_008.8;
const degrees = 180 / Math.PI;
// The composed frame masks approximately 5.5% at the top, 9.2% at the bottom.
const targetSky = .055 + (.908 - .055) * .29;
const subjectBand = [0.58, 0.81] as const;
export const JOURNEY_MIN_EYE_HEIGHT_M = 29;
const maxTerrainLiftM = 80;
const horizonSamples = [
  22, 32, 43, 56, 70, 86, 105, 128, 154, 185, 220, 261, 310, 370, 440, 525, 625, 745,
  890, 1070, 1300, 1580, 1930, 2360, 2890, 3540, 4350, 5350, 6600, 8200, 10300, 13200,
  17300, 22400, 29000,
].map(distance=>({
  distance, sinArc:Math.sin(distance/radiusM), cosArc:Math.cos(distance/radiusM),
  curvature:distance*distance/(2*radiusM),
}));
export const JOURNEY_CAMERA_LAG_M = 90;
export const JOURNEY_CAMERA_HEIGHT_M = 43;

export interface JourneyCameraTerrain {
  heightAt: (longitude: number, latitude: number) => number | null;
  skylineHeightAt?: (longitude: number, latitude: number) => number | null;
  horizonAt?: (bearing: number, position: SkyJourneyCoordinate, altitude: number) => number | null;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const wrap = (angle: number) => ((angle % 360) + 360) % 360;
const usable = (height: number | null | undefined): height is number => height != null && Number.isFinite(height);

export function journeyBearing(from: SkyJourneyCoordinate, to: SkyJourneyCoordinate) {
  const [lon1, lat1] = from.map(angle => angle / degrees);
  const [lon2, lat2] = to.map(angle => angle / degrees);
  const diff = lon2 - lon1;
  return wrap(Math.atan2(Math.sin(diff) * Math.cos(lat2),
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(diff)) * degrees);
}

export function journeyDestination(origin: SkyJourneyCoordinate, bearing: number, distance: number): [number, number] {
  if (distance === 0) return [...origin];
  const [lng, lat] = origin.map(value => value / degrees);
  const angle = distance / radiusM;
  const azimuth = bearing / degrees;
  const endLat = Math.asin(clamp(Math.sin(lat) * Math.cos(angle) +
    Math.cos(lat) * Math.sin(angle) * Math.cos(azimuth), -1, 1));
  const endLng = lng + Math.atan2(Math.sin(azimuth) * Math.sin(angle) * Math.cos(lat),
    Math.cos(angle) - Math.sin(lat) * Math.sin(endLat));
  return [wrap(endLng * degrees + 180) - 180, endLat * degrees];
}

function altitudeAngle(heightDelta: number, distance: number) {
  return Math.atan2(heightDelta - distance * distance / (2 * radiusM), distance) * degrees;
}

function viewAngle(screenY: number, tangent: number) {
  return Math.atan((1 - 2 * screenY) * tangent) * degrees;
}

export function keepJourneySubjectInFrame(pitch: number, eye: number, subject: number, distance: number, verticalFov: number) {
  if (distance <= .1) return pitch;
  const tangent = Math.tan(clamp(verticalFov, 10, 150) / degrees / 2);
  const elevation = altitudeAngle(subject - eye, distance);
  return clamp(pitch, elevation - viewAngle(subjectBand[0], tangent), elevation - viewAngle(subjectBand[1], tangent));
}

function heightAt(terrain: JourneyCameraTerrain | undefined, point: SkyJourneyCoordinate) {
  const height = terrain?.heightAt(point[0], point[1]);
  return usable(height) ? height : null;
}

function estimateSkyline(terrain: JourneyCameraTerrain, camera: SkyJourneyCoordinate, altitude: number,
  bearing: number, horizontalFov: number) {
  const sections: number[] = [];
  const tangent = Math.tan(horizontalFov / degrees / 2);
  const read = terrain.skylineHeightAt ?? terrain.heightAt;
  const lon0 = camera[0], lat0 = camera[1] / degrees;
  const sinLat = Math.sin(lat0), cosLat = Math.cos(lat0);
  for (const column of [-.85, -.56, -.28, 0, .28, .56, .85]) {
    const yaw = Math.atan(column * tangent);
    const azimuth = wrap(bearing + yaw * degrees);
    let peak = terrain.horizonAt?.(azimuth, camera, altitude) ?? -Infinity;
    if (!Number.isFinite(peak)) {
      // All samples along this ray share its origin, bearing and arc distances.
      const cosBearing = Math.cos(azimuth/degrees), sinBearing = Math.sin(azimuth/degrees);
      let steepest = -Infinity;
      for (const {distance, sinArc, cosArc, curvature} of horizonSamples) {
        const sinDest = clamp(sinLat*cosArc + cosLat*sinArc*cosBearing,-1,1);
        const latitude = Math.asin(sinDest)*degrees;
        const longitude = lon0 + Math.atan2(sinBearing*sinArc*cosLat,cosArc-sinLat*sinDest)*degrees;
        const ground = read(wrap(longitude+180)-180,latitude);
        if (usable(ground)) steepest = Math.max(steepest, (ground-altitude-curvature)/distance);
      }
      if (Number.isFinite(steepest)) peak=Math.atan(steepest)*degrees;
    }
    if (Number.isFinite(peak)) {
      // Convert the bearing ray to the vertical plane used by the pinhole viewport.
      sections.push(Math.atan(Math.tan(peak / degrees) / Math.cos(yaw)) * degrees);
    }
  }
  return sections;
}

function visibleSky(sections: readonly number[], pitch: number, tangent: number) {
  let total = 0;
  for (const horizon of sections) {
    const angle = clamp(horizon - pitch, -89, 89) / degrees;
    total += clamp((1 - Math.tan(angle) / tangent) / 2, 0, 1);
  }
  return total / sections.length;
}

function skyPitch(sections: readonly number[], tangent: number) {
  let low = -78, high = 45;
  for (let iteration = 0; iteration < 12; iteration++) {
    const mid = (low + high) / 2;
    if (visibleSky(sections, mid, tangent) < targetSky) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function resolveJourneyCamera(
  frame: JourneyPlaybackFrame,
  optics: DeviceSkyOptics,
  terrain?: JourneyCameraTerrain,
) {
  const subjectGround = heightAt(terrain, frame.coordinates);
  const subjectAltitude = subjectGround !== null ? subjectGround + 1
    : usable(frame.elevationM) ? frame.elevationM + 1 : null;
  const height = frame.cameraHeightM ?? JOURNEY_CAMERA_HEIGHT_M;
  const fallback = frame.cameraElevationM ?? (subjectAltitude !== null ? subjectAltitude - 1 + height : null);
  const tangent = Math.tan(clamp(optics.verticalFov, 10, 150) / degrees / 2);

  function evaluate(position: [number, number], eyeHeight: number) {
    const ground = heightAt(terrain, position);
    if (ground === null && position !== frame.cameraCoordinates) return null;
    let altitude = ground !== null ? ground + eyeHeight : fallback;
    if (altitude !== null && subjectAltitude !== null) {
      altitude = Math.max(altitude, subjectAltitude + Math.min(eyeHeight, eyeHeight < height ? 20 : 35));
    }
    const distance = metresBetween(position, frame.coordinates);
    const azimuth = distance > 0.1 ? journeyBearing(position, frame.coordinates) : frame.cameraHeadingDeg ?? frame.headingDeg ?? 0;
    let subjectOccluded = false;
    if (terrain && ground !== null && subjectGround !== null && subjectAltitude !== null && altitude !== null && distance > 1) {
      let minimumVisible = altitude;
      for (const fraction of [.10, .20, .30, .40, .50, .60, .70, .80, .90, .95]) {
        const obstacle = heightAt(terrain, journeyDestination(position, azimuth, distance * fraction));
        if (obstacle === null) continue;
        minimumVisible = Math.max(minimumVisible, (obstacle + 0.7 - fraction * subjectAltitude) / (1 - fraction));
      }
      altitude = Math.min(minimumVisible, altitude + maxTerrainLiftM);
      subjectOccluded = altitude + .01 < minimumVisible;
    }

    const groundKnown = ground !== null && subjectGround !== null;
    const skyline = terrain && altitude !== null ? estimateSkyline(terrain, position, altitude, azimuth, optics.horizontalFov) : [];
    const sections = skyline.length ? skyline : [0];
    const desiredPitch = skyPitch(sections, tangent);
    let pitch = desiredPitch;
    if (altitude !== null && subjectAltitude !== null)
      pitch = keepJourneySubjectInFrame(pitch, altitude, subjectAltitude, distance, optics.verticalFov);
    pitch = clamp(pitch, -78, 45);
    return { position, altitude, subjectAltitude, groundKnown, subjectOccluded, distance, desiredPitch,
      skyFraction: visibleSky(sections, pitch, tangent), pose: { azimuth, altitude: pitch, roll: 0 } satisfies DeviceSkyPose };
  }

  const base = evaluate(frame.cameraCoordinates, height)!;
  let best = base;
  if (base.groundKnown && base.distance > 1 && frame.headingDeg !== null &&
      (base.subjectOccluded || base.skyFraction < targetSky - .012)) {
    const travel = (frame.cameraHeadingDeg ?? frame.headingDeg) + 180;
    const reducedEye = Math.min(height, JOURNEY_MIN_EYE_HEIGHT_M);
    const setback = base.distance + clamp((targetSky - base.skyFraction) * 400, 13, 67);
    const score = (candidate: typeof base) =>
      Math.abs(targetSky - candidate.skyFraction) + (candidate.subjectOccluded ? 1 : 0) +
      Math.abs(candidate.distance - base.distance) * .0006;
    const improvedAt = (distance: number, eye: number) => {
      const point = distance === base.distance ? frame.cameraCoordinates : journeyDestination(frame.coordinates, travel, distance);
      const candidate = evaluate(point, eye);
      if (candidate && score(candidate) < score(best)) best = candidate;
    };
    improvedAt(base.distance, reducedEye);
    if (best.subjectOccluded || best.skyFraction < targetSky - .02) {
      improvedAt(setback, (height + reducedEye) / 2);
      if (best.subjectOccluded || best.skyFraction < targetSky - .022) improvedAt(setback, reducedEye);
    }
  }
  return best;
}
