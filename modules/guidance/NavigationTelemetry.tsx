import type { GuidanceSession } from './session';
import type { PositionFix } from '../position/types';
import { useNavigationTelemetry } from './useNavigationTelemetry';
import { clockDuration } from '../rally/roadbook';
import { RallyElevation, type NavigationElevationDisplay } from '../rally/RallyElevation';
import '../rally/rally.css';

export function NavigationTelemetry({ session, fix, elevation = false, display }: {
  session: GuidanceSession; fix: PositionFix | null; elevation?: boolean; display?: NavigationElevationDisplay;
}) {
  const t = useNavigationTelemetry(session.route, session, fix);
  if (elevation) return <div className="navigation-elevation"><RallyElevation route={session.route} fraction={t.fraction} display={display} /></div>;
  return <section className="navigation-telemetry" aria-label="导航速度与时间">
    <div className="navigation-speeds"><span>实时速度 <strong>{t.speed === null ? '—' : t.speed.toFixed(1)}<small> km/h</small></strong></span><span>平均速度 <strong>{t.average === null ? '—' : t.average.toFixed(1)}<small> km/h</small></strong></span></div>
    <div className="navigation-times"><span>已用 {t.elapsed === null ? '—' : clockDuration(t.elapsed)}</span><span>还需 {t.remainingSeconds === null ? '—' : `约${Math.ceil(t.remainingSeconds / 60)}分`}</span><span>到达 {t.arrival}</span></div>
  </section>;
}
