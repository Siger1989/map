import { useMemo } from 'react';
import type { PlannedRoute } from '../navigation/types';
import type { ManualTrack } from '../tracks/drawing';
import { useTrackElevation } from '../routeAnalysis/useTrackElevation';
import { trackHeights } from '../routeAnalysis/trackElevation';
import { elevationStats } from '../journey/metrics';
import { routeElevationScale } from '../routeAnalysis/elevationColors';
import { RouteElevationProfile } from '../routeDisplay/RouteElevationProfile';
import type { RouteDisplayPreferences } from '../routeDisplay/preferences';
import type { AnalysisMode } from '../routeAnalysis/metrics';
import type { ElevationScale } from '../routeAnalysis/elevationColors';
import { RouteColorKey } from '../routeDisplay/RouteColorKey';

export type NavigationElevationDisplay = {
  preferences: Pick<RouteDisplayPreferences, 'profile' | 'statistics' | 'legend'>;
  mode: AnalysisMode;
  scale: ElevationScale;
};

export function RallyElevation({ route, fraction, display }: { route: PlannedRoute; fraction: number | null; display?: NavigationElevationDisplay }) {
  const { profile = true, statistics = true, legend = true } = display?.preferences ?? {};
  const showLegend = legend && !!display && display.mode !== 'solid';
  const track = useMemo<ManualTrack>(() => ({ id: `rally-${route.createdAt}`, name: '导航海拔', createdAt: route.createdAt, segments: [route.coordinates] }), [route]);
  const elevation = useTrackElevation(track, profile || statistics);
  const samples = useMemo(() => trackHeights(elevation.profile ?? track), [elevation.profile, track]);
  const distance = fraction === null ? null : (samples.at(-1)?.distance ?? 0) * fraction;
  const i = distance === null ? -1 : samples.findIndex(s => s.distance >= distance);
  const b = samples[i], a = samples[Math.max(0, i - 1)];
  const height = a?.elevation != null && b?.elevation != null && distance !== null
    ? a.elevation + (b.elevation - a.elevation) * ((distance - a.distance) / (b.distance - a.distance || 1)) : null;
  const completed = distance === null ? [] : [...samples.filter(s => s.distance < distance), ...(b ? [{ ...b, distance, elevation: height }] : [])];
  const stats = elevationStats(completed);
  const value = (n: number | null) => n === null ? '—' : `${Math.round(n)}m`;
  if (!profile && !statistics && !showLegend) return null;
  return <section className="rally-elevation" aria-label="导航底部路线信息" data-profile={profile} data-statistics={statistics} data-body={profile || statistics}>
    {profile && <RouteElevationProfile samples={samples} scale={routeElevationScale(elevation.profile ?? track)} progress={distance} compact />}
    {statistics && <dl aria-label="当前海拔与已行升降"><div><dt>当前海拔</dt><dd>{value(height)}</dd></div><div><dt>已行爬升</dt><dd>{value(stats.ascent)}</dd></div><div><dt>已行下降</dt><dd>{value(stats.descent)}</dd></div></dl>}
    <small>{(profile || statistics) && <span title="剖面蓝低红高；当前海拔和已行升降需有效定位">{elevation.loading ? '高程读取中' : elevation.elevationError ? '高程缺测' : '地形估算'}{fraction === null ? '·待定位' : ''}</span>}{showLegend && <RouteColorKey mode={display.mode} scale={display.scale} />}</small>
  </section>;
}
