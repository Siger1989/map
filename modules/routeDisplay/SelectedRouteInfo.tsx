import { useMemo } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import { useDockClearance } from '../tracks/useDockClearance';
import { useTrackElevation } from '../routeAnalysis/useTrackElevation';
import { trackHeights } from '../routeAnalysis/trackElevation';
import { routeElevationScale } from '../routeAnalysis/elevationColors';
import { elevationStats } from '../journey/metrics';
import type { RouteDisplayPreferences } from './preferences';
import { RouteElevationProfile } from './RouteElevationProfile';
import { RouteColorKey } from './RouteColorKey';
import type { TrackLinePoint } from '../tracks/linePoint';
import { routePointMetrics } from '../routeAnalysis/pointMetrics';
import { analyzeRoute } from '../routeAnalysis/metrics';
import { formatDistance } from '../navigation/types';
import './selectedRouteInfo.css';

/** Selected-route totals use the same switches as navigation, without claiming live progress. */
export function SelectedRouteInfo({ track, preferences, reversed = false, point }: { track: ManualTrack; preferences: RouteDisplayPreferences; reversed?: boolean; point?: TrackLinePoint | null }) {
  const mode = preferences.mode === 'original' ? track.style?.colorMode ?? 'solid' : preferences.mode;
  if (!preferences.profile && !preferences.statistics && !(preferences.legend && mode !== 'solid')) return null;
  return <SelectedRouteInfoBody track={track} preferences={preferences} mode={mode} reversed={reversed} point={point} />;
}

function SelectedRouteInfoBody({ track, preferences, mode, reversed, point }: {
  track: ManualTrack; preferences: RouteDisplayPreferences; mode: 'solid' | 'speed' | 'elevation' | 'slope'; reversed:boolean; point?:TrackLinePoint|null;
}) {
  const dock = useDockClearance('--selected-info-clearance');
  const elevation = useTrackElevation(track, preferences.profile || preferences.statistics || mode === 'elevation');
  const profile = elevation.profile ?? track;
  const samples = useMemo(() => {
    const values = trackHeights(profile), total = values.at(-1)?.distance ?? 0;
    return reversed ? values.reverse().map(v => ({...v,distance:total-v.distance})) : values;
  }, [profile, reversed]);
  const stats = useMemo(() => elevationStats(samples), [samples]);
  const scale = useMemo(() => routeElevationScale(profile), [profile]);
  const analysis = useMemo(()=>analyzeRoute(track),[track]);
  const profileAnalysis = useMemo(()=>analyzeRoute(profile),[profile]);
  const selected = useMemo(()=>point?.trackId===track.id ? routePointMetrics(track,point,profile,profileAnalysis,analysis) : null,[track,point,profile,profileAnalysis,analysis]);
  const total = samples.at(-1)?.distance ?? 0;
  const selection = selected ? {distance:Math.max(0,Math.min(total,reversed?total-selected.profileDistance:selected.profileDistance)),elevation:selected.elevation} : null;
  const selectedSlope = selected?.slopeDegrees == null ? null : selected.slopeDegrees*(reversed?-1:1);
  const value = (n: number | null) => n === null ? '—' : `${Math.round(n)}m`;
  return <section ref={dock} className="selected-route-info" aria-label="所选路线底部信息">
    {preferences.profile && <RouteElevationProfile samples={samples} scale={scale} selection={selection} compact endpoints />}
    {selected && (preferences.profile || preferences.statistics) && <div className="selected-route-point" aria-label="剖面所选点信息">
      <span>选中 · {formatDistance(reversed?Math.max(0,analysis.distance-selected.distance):selected.distance)}</span>
      <span>海拔 <b>{value(selected.elevation)}</b></span>
      <span>路段坡度 <b>{selectedSlope===null?'—':`${selectedSlope>0?'+':''}${selectedSlope.toFixed(1)}°`}</b></span>
      {selected.speedKmh!==null && <span>速度 <b>{selected.speedKmh.toFixed(1)} km/h</b></span>}
    </div>}
    {preferences.statistics && <dl aria-label="路线海拔汇总">
      <div><dt>海拔范围</dt><dd>{scale ? `${Math.round(scale.min)}–${Math.round(scale.max)}m` : '—'}</dd></div>
      <div><dt>全程爬升</dt><dd>{value(stats.ascent)}</dd></div>
      <div><dt>全程下降</dt><dd>{value(stats.descent)}</dd></div>
    </dl>}
    {preferences.legend && mode !== 'solid' && <RouteColorKey mode={mode} scale={scale} travelMode={track.style?.travelMode} />}
    {(preferences.profile || preferences.statistics) && <small>{elevation.loading ? '高程读取中' : elevation.elevationError ? '部分高程缺测' : elevation.estimated ? '含地形估算' : '轨迹高程'}</small>}
  </section>;
}
