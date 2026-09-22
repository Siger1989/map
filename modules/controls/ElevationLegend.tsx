import { ELEVATION_COLORS } from '../terrain/elevationColors';
export function ElevationLegend() {
  const gradient=ELEVATION_COLORS.map(([h,c])=>`${c} ${(h+500)/9500*100}%`).join(',');
  return <aside className="elevation-legend elevation-legend-compact" aria-label="海拔颜色参考，单位米" title="海拔色标，米；每50米细分">
    <strong>海拔m</strong><div className="elevation-compact-scale"><i style={{background:`linear-gradient(to top,${gradient})`}}/>
    {[9000,6000,3000,0].map(h=><span key={h} style={{bottom:`${(h+500)/9500*100}%`}}>{h}</span>)}</div>
  </aside>;
}
