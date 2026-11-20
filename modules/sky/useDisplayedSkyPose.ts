import { useLayoutEffect, useRef, useState } from 'react';
import type { DeviceSkyPose } from './deviceSkyCamera';
import { acceptSkyPose, displayedSkyPose, type SkyPoseMode, type SkyPoseMotion } from './skyPoseMotion';

/** Interpolate between received samples at display cadence, stopping as soon as the pose settles. */
export function useDisplayedSkyPose(
  target: DeviceSkyPose, mode: SkyPoseMode, resetKey: string, sampleTimestampMs?: number,
): DeviceSkyPose {
  const [display, setDisplay] = useState({ pose: target, mode, resetKey });
  const input = useRef<{ motion: SkyPoseMotion; mode: SkyPoseMode; resetKey: string } | null>(null);
  const newest = useRef({ target, mode, resetKey });
  newest.current = { target, mode, resetKey };
  const raf = useRef(0);
  useLayoutEffect(() => {
    const last = input.current;
    const resetting = !last || last.mode !== mode || last.resetKey !== resetKey;
    const motion = acceptSkyPose(resetting ? null : last.motion, target, mode, performance.now(), sampleTimestampMs);
    if (!resetting && motion === last.motion) return;
    input.current = { motion, mode, resetKey };
    if (!resetting && motion.to === last.motion.to && motion.received === last.motion.received) return;
    function paint(now: number) {
      raf.current = 0;
      const current = input.current;
      if (!current) return;
      const pose = displayedSkyPose(current.motion, now);
      setDisplay({ pose, mode: current.mode, resetKey: current.resetKey });
      if (pose !== current.motion.to) raf.current = requestAnimationFrame(paint);
    }
    if (!motion.duration) {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      setDisplay({ pose: motion.to, mode, resetKey });
    } else if (!raf.current) raf.current = requestAnimationFrame(paint);
  }, [target.azimuth, target.altitude, target.roll, mode, resetKey, sampleTimestampMs]);

  useLayoutEffect(() => {
    const clear = () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      input.current = null;
    };
    const visibility = () => {
      clear();
      if (!document.hidden) {
        const { target, mode, resetKey } = newest.current;
        setDisplay({ pose: target, mode, resetKey });
      }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); clear(); };
  }, []);
  return mode === 'snap' || display.mode !== mode || display.resetKey !== resetKey ? target : display.pose;
}
