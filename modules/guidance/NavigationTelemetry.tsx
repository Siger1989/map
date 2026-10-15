import type { GuidanceSession } from './session';
import type { PositionFix } from '../position/types';
import { useNavigationTelemetry } from './useNavigationTelemetry';
import { clockDuration } from '../rally/roadbook';
import { RallyElevation, type NavigationElevationDisplay } from '../rally/RallyElevation';
import '../rally/rally.css';
import './telemetry.css';

export function NavigationTelemetry({ session, fix, elevation = false, display, previewFraction, compact = false }: {
  session: GuidanceSession; fix: PositionFix | null; elevation?: boolean; display?: NavigationElevationDisplay; previewFraction?: number | null; compact?: boolean;
}) {
  const t = useNavigationTelemetry(session.route, session, fix);
  if (elevation) return <div className="navigation-elevation"><RallyElevation route={session.route} fraction={t.fraction} display={display} previewFraction={previewFraction} /></div>;
  const missingSpeed = t.hasLocation ? '等待速度' : '等待定位';
  const missingAverage = t.average === null && t.hasLocation ? '等待行程' : '等待定位';
  const speedMissing = t.speed === null;
  const averageMissing = t.average === null;
  return <section className={`navigation-telemetry${compact ? ' navigation-telemetry--compact' : ''}`} aria-label="导航速度与时间" data-compact={compact || undefined}>
    <div className="navigation-speeds"><span><span className="navigation-speed-label">{compact ? '实时' : '实时速度'}</span><strong data-missing={compact && speedMissing || undefined}>{speedMissing ? compact ? missingSpeed : '—' : t.speed!.toFixed(1)}{!speedMissing && <small> km/h</small>}</strong></span><span><span className="navigation-speed-label">{compact ? '均速' : '平均速度'}</span><strong data-missing={compact && averageMissing || undefined}>{averageMissing ? compact ? missingAverage : '—' : t.average!.toFixed(1)}{!averageMissing && <small> km/h</small>}</strong></span></div>
    {!compact && <div className="navigation-times"><span>已用 {t.elapsed === null ? '—' : clockDuration(t.elapsed)}</span><span>还需 {t.remainingSeconds === null ? '—' : `约${Math.ceil(t.remainingSeconds / 60)}分`}</span><span>到达 {t.arrival}</span></div>}
  </section>;
}
