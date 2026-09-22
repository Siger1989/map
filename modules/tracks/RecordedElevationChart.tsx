import { useMemo, useState } from 'react';
import type { ManualTrack } from './drawing';
import { useTrackElevation } from '../routeAnalysis/useTrackElevation';
import { recordedProfile, speedColor, RECORDED_SPEED_COLORS } from './recordedProfileData';
import { formatDistance } from '../navigation/types';

export function RecordedProfile({ track }: { track: ManualTrack }) {
  const elevation = useTrackElevation(track, true);
  const points = useMemo(() => recordedProfile(track, elevation.data ?? track), [track, elevation.data]);
  const [index, select] = useState(0);
  const selected = Math.min(index, points.length - 1), point = points[selected];
  if (!point) return null;
  const heights = points.flatMap(p => p.altitude === null ? [] : [p.altitude]);
  const low = heights.length ? Math.min(...heights) : 0, high = heights.length ? Math.max(...heights) : 1;
  const total = points.at(-1)!.distance;
  const x = (p: typeof point) => 28 + p.distance / Math.max(total, 1) * 304;
  const y = (p: typeof point) => p.altitude === null ? 112 : 108 - (p.altitude - low) / Math.max(high - low, 1) * 78;
  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const target = (event.clientX - rect.left) / rect.width * 360;
    let nearest = 0;
    points.forEach((p, i) => { if (Math.abs(x(p) - target) < Math.abs(x(points[nearest]) - target)) nearest = i; });
    select(nearest);
  };
  return <section className="recorded-profile" aria-label="海拔与速度交互图">
    <h3>海拔曲线 · 按速度着色</h3>
    <svg viewBox="0 0 360 136" role="img" aria-label="拖动曲线选点；下方滑块也可逐点查看" style={{touchAction:'none'}}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); pick(event); }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event); }}>
      <path d="M28 20V112H332" fill="none" stroke="#a6b7af" />
      <text x="28" y="14">{heights.length ? `${Math.round(low)}–${Math.round(high)} m` : '海拔缺测'}</text>
      {points.map((p,i) => { const a=points[i-1]; return a && p.connected && a.altitude !== null && p.altitude !== null ? <path key={i} d={`M${x(a)} ${y(a)}L${x(p)} ${y(p)}`} fill="none" stroke={speedColor(p.speed)} strokeWidth="2.5" strokeLinecap="round" /> : null; })}
      <path d={`M${x(point)} 20V112`} stroke="#305e55" strokeDasharray="3 3" />
      <circle cx={x(point)} cy={y(point)} r="5" fill={speedColor(point.speed)} stroke="white" strokeWidth="2" />
      <text x="28" y="130">0</text><text x="332" y="130" textAnchor="end">{formatDistance(total)}</text>
    </svg>
    <input type="range" aria-label="查看轨迹采样点" min="0" max={points.length-1} step="1" value={selected} onChange={e => select(Number(e.target.value))} />
    <div className="recorded-speed-legend" aria-label="速度颜色图例">{RECORDED_SPEED_COLORS.map(b => <span key={b.label}><i style={{background:b.color}}/>{b.label}</span>)}<span><i style={{background:'#8b9699'}}/>缺测</span><b>km/h</b></div>
    <output className="recorded-point-info" aria-live="polite"><span>第 {selected+1} 点 · 第 {point.part+1} 段</span><span>{formatDistance(point.distance)}</span><span>{point.time === null ? '无时间' : new Date(point.time).toLocaleTimeString('zh-CN',{hour12:false})}</span><span>海拔 {point.altitude === null ? '缺测' : `${Math.round(point.altitude)} m${point.estimated ? '（估算）' : ''}`}</span><span>区间速度 {point.speed === null ? '无有效区间' : `${point.speed.toFixed(1)} km/h`}</span><span>{point.coordinate[1].toFixed(5)}, {point.coordinate[0].toFixed(5)}</span></output>
    <small>速度取相邻采样点区间；断点不连线。{elevation.loading ? '正在补充缺测海拔…' : elevation.estimated ? '部分海拔为地形估算。' : ''}</small>
  </section>;
}
