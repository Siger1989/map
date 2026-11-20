import type { DeviceSkyPose } from './deviceSkyCamera.ts';

export type SkyPoseMode = 'sensor' | 'drag' | 'snap';

export function shortestTurn(from: number, to: number) {
  return ((to - from + 180) % 360 + 360) % 360 - 180;
}

export interface SkyPoseMotion {
  from: DeviceSkyPose;
  to: DeviceSkyPose;
  received: number;
  lastInput: number;
  timestamp: number;
  duration: number;
}

export function displayedSkyPose(motion: SkyPoseMotion, now: number): DeviceSkyPose {
  if (motion.duration === 0 || now >= motion.received + motion.duration) return motion.to;
  const fraction = Math.max(0, (now - motion.received) / motion.duration);
  if (fraction === 0) return motion.from;
  const { from, to } = motion;
  // The same optical frame has two Euler representations. A lens crossing the
  // zenith/nadir reverses both yaw and roll while its physical rotation is tiny.
  const crossesPole = Math.abs(from.altitude) > 70 && from.altitude * to.altitude > 0 &&
    Math.abs(to.altitude) > 70 && Math.abs(shortestTurn(from.azimuth, to.azimuth)) > 90 &&
    Math.abs(shortestTurn(from.roll, to.roll)) > 90;
  const targetPitch = crossesPole ? Math.sign(to.altitude) * 180 - to.altitude : to.altitude;
  const pitch = from.altitude + (targetPitch - from.altitude) * fraction;
  const beyondPole = Math.abs(pitch) > 90;
  const arc = (a: number, b: number) => a + shortestTurn(a, b + (crossesPole ? 180 : 0)) * fraction +
    (beyondPole ? 180 : 0);
  return {
    azimuth: (arc(from.azimuth, to.azimuth) % 360 + 360) % 360,
    altitude: beyondPole ? Math.sign(pitch) * 180 - pitch : pitch,
    roll: shortestTurn(0, arc(from.roll, to.roll)),
  };
}

/** Sample timestamps measure input cadence; only page time is used for painting. */
export function acceptSkyPose(
  previous: SkyPoseMotion | null,
  pose: DeviceSkyPose,
  mode: SkyPoseMode,
  now: number,
  timestamp = now,
): SkyPoseMotion {
  const stamp = Number.isFinite(timestamp) ? timestamp : now;
  if (mode !== 'snap' && previous && stamp < previous.timestamp) return previous;
  if (!previous || mode === 'snap' || now - previous.lastInput > 180 || stamp - previous.timestamp > 180) {
    return { from: pose, to: pose, received: now, lastInput: now, timestamp: stamp, duration: 0 };
  }
  const from = displayedSkyPose(previous, now);
  if (pose.azimuth === previous.to.azimuth && pose.altitude === previous.to.altitude && pose.roll === previous.to.roll) {
    return { ...previous, lastInput: now, timestamp: stamp };
  }
  const elapsed = Math.max(0, stamp - previous.timestamp);
  const duration = Math.min(mode === 'sensor' ? 55 : 26, Math.max(12, elapsed));
  return { from, to: pose, received: now, lastInput: now, timestamp: stamp, duration };
}
