import { elevationColorsForInterval } from '../terrain/elevationColors';
import { contourInterval } from '../terrain/contourInterval';

export function ElevationLegend({ interval = 30 }: { interval?: number }) {
  const step = contourInterval(interval);
  const colors = elevationColorsForInterval(step);
  const gradient = colors.flatMap(([height, color], index) => {
    const percent = (height + 500) / 9500 * 100;
    const prior = colors[index - 1]?.[1] ?? color;
    return index === 0
      ? [`${color} ${percent}%`]
      : [`${prior} ${percent}%`, `${color} ${percent}%`];
  }).join(',');
  return <aside className="elevation-legend elevation-legend-compact" aria-label={`海拔颜色参考，单位米，色阶间隔${step}米`} title={`海拔色标，米；每${step}米一个色阶`}>
    <strong>海拔m</strong><div className="elevation-compact-scale"><i style={{background:`linear-gradient(to top,${gradient})`}}/>
    {[9000,6000,3000,0].map(h=><span key={h} style={{bottom:`${(h+500)/9500*100}%`}}>{h}</span>)}</div>
  </aside>;
}
