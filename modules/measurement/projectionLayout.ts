import { measurementMetrics, type MeasurePoint } from './data.ts';

/** Compact full-polyline diagram; keep short segments readable and scroll long chains. */
export function projectionLayout(points: MeasurePoint[]) {
  const metrics = measurementMetrics(points);
  const count = Math.max(1, points.length - 1);
  const natural = metrics.segments.map(s => Math.max(52, Math.min(160,
    s.horizontal / Math.max(1, metrics.horizontal) * count * 80)));
  const factor = Math.max(1, 224 / Math.max(1, natural.reduce((a,b)=>a+b,0)));
  const xs = [18], chainage = [0];
  natural.forEach((w,i)=>{xs.push(xs.at(-1)!+w*factor);chainage.push(chainage.at(-1)!+metrics.segments[i].horizontal);});
  const heights = points.flatMap(p=>p.altitude===null?[]:[p.altitude]);
  const low = heights.length ? Math.min(...heights) : 0;
  const range = heights.length ? Math.max(...heights)-low : 0;
  return { width: Math.max(260,xs.at(-1)!+18), chainage,
    nodes: points.map((p,i)=>({x:xs[i],y:p.altitude===null?68:range===0?42:68-(p.altitude-low)/range*44})),
    segments: metrics.segments };
}
