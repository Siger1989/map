import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera.ts';
import { JOURNEY_MIN_EYE_HEIGHT_M, journeyBearing, journeyDestination, keepJourneySubjectInFrame, resolveJourneyCamera, type JourneyCameraTerrain } from './journeyCamera.ts';
import { getJourneySegmentFrame, type JourneyPlaybackFrame, type JourneyPlaybackModel } from './journeyPlayback.ts';

interface FollowView {
  position: [number, number];
  altitude: number | null;
  subjectAltitude: number | null;
  pose: DeviceSkyPose;
}

type Control = ReturnType<typeof resolveJourneyCamera>;

/** Smooth the boom and pitch along the trail. Screen refresh and video encoding run at different rates. */
export function createJourneyCameraRail() {
  let model: JourneyPlaybackModel | undefined;
  let settingsKey = '';
  // Keep solved control points as imagery refines underneath them. An unresolved
  // point may try again on the next terrain revision. Scrubbing to a new section
  // solves its own four local points immediately, without crossing the gap.
  const controls = new Map<number, { value: Control; revision: number }>();

  function resolve(route: JourneyPlaybackModel, frame: JourneyPlaybackFrame, optics: DeviceSkyOptics,
    terrain: JourneyCameraTerrain, revision: number): FollowView {
    const segment = route.segments[frame.segmentIndex];
    const heading = frame.cameraHeadingDeg;
    if (!segment || heading === null || frame.cameraLagM === 0) return resolveJourneyCamera(frame, optics, terrain);
    const key = [frame.segmentIndex, frame.cameraLagM, frame.cameraHeightM, frame.cameraTurnRadiusM,
      optics.horizontalFov, optics.verticalFov].join('/');
    if (model !== route || key !== settingsKey) {
      controls.clear();
      model = route;
      settingsKey = key;
    }
    const length = segment.endDistanceM - segment.startDistanceM;
    const intervals = Math.max(1, Math.ceil(length / Math.max(16, Math.min(52, frame.cameraTurnRadiusM * .55))));
    const offset = (frame.distanceM - segment.startDistanceM) / length * intervals;
    const index = Math.floor(offset);
    const t = offset - index, s = 1 - t;
    // The four positive cubic B-spline weights share position, velocity and
    // acceleration at each knot, including when the terrain solver changes boom.
    const weights = [s*s*s / 6, (4 - 6*t*t + 3*t*t*t) / 6,
      (4 - 6*s*s + 3*s*s*s) / 6, t*t*t / 6];
    let height = 0, pitch = 0, distance = 0, weight = 0;
    for (let i = 0; i < 4; i++) {
      if (!weights[i]) continue;
      const knot = Math.max(0, Math.min(intervals, index + i - 1));
      let entry = controls.get(knot);
      if (!entry || (!entry.value.groundKnown && entry.revision !== revision)) {
        const sample = getJourneySegmentFrame(segment, frame.segmentIndex, segment.startDistanceM + length * knot / intervals,
          { cameraHeightM:frame.cameraHeightM, cameraLagM:frame.cameraLagM, turnRadiusM:frame.cameraTurnRadiusM });
        entry = { value: resolveJourneyCamera(sample, optics, terrain), revision };
        if (controls.size >= 192 && !controls.has(knot)) controls.delete(controls.keys().next().value!);
        controls.set(knot, entry);
      }
      const control = entry.value;
      if (!control.groundKnown || control.altitude === null) continue;
      height += weights[i] * control.altitude;
      pitch += weights[i] * control.pose.altitude;
      distance += weights[i] * control.distance;
      weight += weights[i];
    }
    if (!weight) return resolveJourneyCamera(frame, optics, terrain);
    distance /= weight;
    const position = journeyDestination(frame.coordinates, heading + 180, distance);
    const ground = terrain.heightAt(...position);
    const sampledSubject = terrain.heightAt(...frame.coordinates);
    const subject = sampledSubject !== null && Number.isFinite(sampledSubject) ? sampledSubject : frame.elevationM;
    const subjectAltitude = subject === null ? null : subject + 1;
    // Allow the rail to pass above narrow crests falling between control points.
    const clearance = Math.min(frame.cameraHeightM, JOURNEY_MIN_EYE_HEIGHT_M);
    const altitude = Math.max(height / weight, ground !== null && Number.isFinite(ground) ? ground + clearance : -Infinity);
    pitch /= weight;
    if (subjectAltitude !== null)
      pitch = keepJourneySubjectInFrame(pitch, altitude, subjectAltitude, distance, optics.verticalFov);
    return { position, altitude, subjectAltitude, pose: { azimuth: journeyBearing(position, frame.coordinates), altitude: pitch, roll: 0 } };
  }
  return { resolve };
}
