import { useEffect, useRef, useState } from 'react';
import type { PlannedRoute } from '../navigation/types';
import type { PositionFix } from '../position/types';
import type { GuidanceSession } from './session';
import { freshFix } from './session';
import { fixSpeed } from '../rally/roadbook';

/** Shared presentation values; never substitutes map centre or preview data for a fix. */
export function useNavigationTelemetry(route: PlannedRoute, session: GuidanceSession | null, fix: PositionFix | null) {
  const [now, setNow] = useState(Date.now);
  const previous = useRef<PositionFix | null>(null);
  const [measured, setMeasured] = useState<{ speed: number | null; at: number }>({ speed: null, at: 0 });
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { previous.current = null; setMeasured({ speed: null, at: 0 }); }, [session?.startedAt, route.createdAt]);
  useEffect(() => {
    if (fix && fix.timestamp !== previous.current?.timestamp) {
      setMeasured({ speed: fixSpeed(previous.current, fix, route.mode, Date.now()), at: fix.timestamp });
      previous.current = fix;
    }
  }, [fix, route.mode]);
  const located = !!session && !session.departurePending && !session.quality && !session.offRoute && freshFix(session.last, now);
  const fraction = located ? Math.min(1, session.progress / (session.path.length || 1)) : null;
  const elapsed = session ? Math.max(0, (now - session.startedAt) / 1000) : null;
  const speed = located && now - measured.at <= 20000 ? measured.speed : null;
  const average = located && !session.gap && elapsed && elapsed > 0 ? session.travelled / elapsed * 3.6 : null;
  const remainingSeconds = fraction === null ? null : route.duration * (1 - fraction);
  const arrival = remainingSeconds === null ? '—' : new Date(now + remainingSeconds * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return { located, fraction, elapsed, speed, average, remainingSeconds, arrival };
}
