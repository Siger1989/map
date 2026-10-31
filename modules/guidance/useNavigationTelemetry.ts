import { useEffect, useRef, useState } from 'react';
import type { PlannedRoute } from '../navigation/types';
import type { PositionFix } from '../position/types';
import type { GuidanceSession } from './session';
import { freshFix } from './session.ts';
import { fixSpeed } from '../rally/roadbook.ts';

const MAX_SPEED_MPS = { auto: 80, bicycle: 30, pedestrian: 12, motorcycle: 80 } as const;

/** Only use a fresh device fix. Network/IP estimates are not motion telemetry. */
export function isTelemetryFix(fix: PositionFix | null, now: number): fix is PositionFix {
  return !!fix && fix.source !== 'network' && fix.provider !== 'ip' && freshFix(fix, now);
}

/** Prefer the device's measured GPS speed; fall back to plausible fix-to-fix motion. */
export function navigationFixSpeed(previous: PositionFix | null, fix: PositionFix | null, mode: PlannedRoute['mode'], now: number) {
  if (!isTelemetryFix(fix, now)) return null;
  const maximum = MAX_SPEED_MPS[mode];
  if (Number.isFinite(fix.speed) && fix.speed! >= 0 && fix.speed! <= maximum)
    return fix.speed! * 3.6;
  if (!isTelemetryFix(previous, now)) return null;
  return fixSpeed(previous, fix, mode, now);
}

/** Session average includes stopped time and remains available through fix gaps/off-route states. */
export function navigationAverageSpeed(session: GuidanceSession | null, elapsed: number | null) {
  if (!session || elapsed === null || elapsed <= 0 || !Number.isFinite(session.travelled) || session.travelled <= 0)
    return null;
  const value = session.travelled / elapsed * 3.6;
  return Number.isFinite(value) ? value : null;
}

/** Shared presentation values; never substitutes map centre or preview data for a fix. */
export function useNavigationTelemetry(route: PlannedRoute, session: GuidanceSession | null, fix: PositionFix | null) {
  const [now, setNow] = useState(Date.now);
  const previous = useRef<PositionFix | null>(null);
  const [measured, setMeasured] = useState<{ speed: number | null; at: number }>({ speed: null, at: 0 });
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { previous.current = null; setMeasured({ speed: null, at: 0 }); }, [session?.startedAt, route.createdAt]);
  useEffect(() => {
    if (fix && fix.timestamp !== previous.current?.timestamp) {
      setMeasured({ speed: navigationFixSpeed(previous.current, fix, route.mode, Date.now()), at: fix.timestamp });
      previous.current = fix;
    }
  }, [fix, route.mode]);
  const located = !!session && !session.departurePending && !session.quality && !session.offRoute && freshFix(session.last, now);
  const fraction = located ? Math.min(1, session.progress / (session.path.length || 1)) : null;
  const elapsed = session ? Math.max(0, (now - session.startedAt) / 1000) : null;
  const speed = measured.at > 0 && measured.at === fix?.timestamp && now - measured.at <= 20000 ? measured.speed : null;
  const average = navigationAverageSpeed(session, elapsed);
  const hasLocation = isTelemetryFix(fix, now);
  const remainingSeconds = fraction === null ? null : route.duration * (1 - fraction);
  const arrival = remainingSeconds === null ? '—' : new Date(now + remainingSeconds * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return { located, hasLocation, fraction, elapsed, speed, average, remainingSeconds, arrival };
}
