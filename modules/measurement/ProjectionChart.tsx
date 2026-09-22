import { lengthLabel, pointLabel, type MeasurePoint, type segmentMetrics } from './data';
import { projectionLayout } from './projectionLayout';

/** Entire measurement chain stays outside the controls; long charts scroll horizontally. */
export function ProjectionChart({ points, metrics, segment, total, saved, hint, reading, onRetry }: {
  points: MeasurePoint[];
  metrics: ReturnType<typeof segmentMetrics> | undefined;
  segment: number;
  total: number | null;
  saved: boolean;
  hint: string | null;
  reading: boolean;
  onRetry: () => void;
}) {
  const layout = projectionLayout(points);
  const missing = points.some(p=>p.altitude===null);
  return <figure className="measurement-chart" aria-label="测量投影剖面图">
    <figcaption><strong>全段剖面</strong><span>{points.length>1 ? `A → ${pointLabel(points.length-1)}` : '等待选点'}</span><small>测点连线 · 非等比</small></figcaption>
    {metrics ? <>
      <div className="measurement-chart-metrics" aria-label="当前线段测量结果">
        <strong>{metrics.inclination===null?'—':`${metrics.inclination.toFixed(1)}°`}<small> 水平夹角</small></strong>
        <span>{pointLabel(segment)}→{pointLabel(segment+1)} · 朝向 {metrics.bearing===null?'—':`${metrics.bearing.toFixed(1)}°`}</span>
      </div>
      <p className="measurement-chart-distance">水平 {lengthLabel(metrics.horizontal)} · 高差 {metrics.rise===null?'—':`${metrics.rise>=0?'+':''}${metrics.rise.toFixed(1)} m`}</p>
      <div className="measurement-chart-scroll" role="region" aria-label="整段测量剖面，可左右滑动" tabIndex={0}>
        <svg className="measurement-chart-plot measurement-chart-full" style={{width:layout.width}} viewBox={`0 0 ${layout.width} 104`} role="img" aria-label={`A到${pointLabel(points.length-1)}全部测点连线、水平参考与垂直投影；距离压缩显示，非连续地形剖面`}>
          <path className="measurement-chart-grid" d={`M18 24H${layout.width-18} M18 46H${layout.width-18} M18 68H${layout.width-18}`}/>
          {layout.segments.map((s,i)=>{
            const a=layout.nodes[i],b=layout.nodes[i+1];
            return s.rise===null ? null : <g key={points[i].id}>
              <path className="measurement-chart-reference" d={`M${a.x} ${a.y} H${b.x} V${b.y}`}/>
              <path className="measurement-chart-slope" data-segment={i} d={`M${a.x} ${a.y} L${b.x} ${b.y}`} style={i===segment?{stroke:'#176bdf',strokeWidth:2.5}:undefined}/>
            </g>;
          })}
          {points.map((p,i)=>{
            const {x,y}=layout.nodes[i];return <g key={p.id} data-profile-point={pointLabel(i)}>
              <circle cx={x} cy={y} r="3" fill={p.altitude===null?'#899895':i===0?'#d4a02b':'#3478ed'}/>
              <text x={x} y={y-9} textAnchor="middle">{pointLabel(i)}{p.altitude===null?' ?':''}</text>
              <text x={x} y="88" textAnchor={i===0?'start':i===points.length-1?'end':'middle'}>{lengthLabel(layout.chainage[i])}</text>
            </g>;
          })}
        </svg>
      </div>
      {missing && <button className="measurement-chart-retry" disabled={reading} onClick={onRetry}>{reading?'读取海拔中…':'部分海拔缺失，重试'}</button>}
    </> : <div className="measurement-chart-empty">添加两个点后，显示整段水平线与投影</div>}
    <p className="measurement-chart-note">{total!==null?`总水平 ${lengthLabel(total)} · `:''}{hint ?? (saved?'已保存到地图和收藏夹':'选上方测点后点地图换位')}{points.length>3?' · 左右滑动查看全段':''}</p>
  </figure>;
}
