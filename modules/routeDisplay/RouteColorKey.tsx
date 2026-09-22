import { speedBands, type TravelMode } from '../routeAnalysis/travelMode';
import type { AnalysisMode } from '../routeAnalysis/metrics';
import { ELEVATION_RAMP, type ElevationScale } from '../routeAnalysis/elevationColors';
import { SLOPE_BANDS } from '../routeAnalysis/config';

/** Compact key for the map line colours, separate from the elevation profile colours. */
export function RouteColorKey({ mode, scale, travelMode }: { mode: AnalysisMode; scale: ElevationScale; travelMode?: TravelMode }) {
  if (mode === 'solid') return null;
  if (mode === 'elevation') return <span className="navigation-color-key" aria-label="路线海拔色标">路线海拔
    <i style={{ width: 32, background: `linear-gradient(90deg,${ELEVATION_RAMP.join(',')})` }} />
    {scale ? `${Math.round(scale.min)}–${Math.round(scale.max)}m` : '缺测'}
  </span>;
  return <span className="navigation-color-key" aria-label="路线颜色图例">{mode === 'speed' ? '速度km/h' : '坡度°'}
    {(mode === 'speed' ? speedBands(travelMode) : SLOPE_BANDS).map((band, i) => <span key={band.color}><i style={{ background: band.color }} />{mode === 'speed' ? band.label : ['<5.7', '5.7–11.3', '≥11.3'][i]}</span>)}
  </span>;
}
