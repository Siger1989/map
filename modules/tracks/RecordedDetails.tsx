import type { ManualTrack } from './drawing';
import { recordedStats, recordedDuration } from './recordedStats';
import { formatDistance } from '../navigation/types';

export function RecordedDetails({ track }: { track: ManualTrack }) {
  const s = recordedStats(track);
  const speed = (v: number | null) => v === null ? '数据不足' : `${v.toFixed(1)} km/h`;
  const time = (v: number | null) => v === null ? '无时间数据' : new Date(v).toLocaleString('zh-CN', { hour12: false });
  const height = (v: number | null) => v === null ? '无实测高程' : `${Math.round(v)} m`;
  return <section className="recorded-details" aria-label="实走记录数据">
    <h3>实走原始记录</h3>
    <dl className="recorded-stats-grid">{[
      ['记录里程', formatDistance(s.distance)], ['起止跨度', recordedDuration(s.elapsed)],
      ['有效采样时长', s.seconds ? recordedDuration(s.seconds) : '数据不足'], ['采样均速', speed(s.averageSpeed)],
      ['移动时长（估算）', s.seconds ? recordedDuration(s.movingSeconds) : '数据不足'], ['移动均速（估算）', speed(s.movingSpeed)],
      ['最高区间速度', speed(s.maxSpeed)], ['暂停或缺测', recordedDuration(s.gapSeconds)],
      ['累计爬升（采样）', height(s.ascent)], ['累计下降（采样）', height(s.descent)],
      ['最低海拔', height(s.minimum)], ['最高海拔', height(s.maximum)],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <dl className="route-data-rows">{[['首个定位点', time(s.start)], ['最后定位点', time(s.end)], ['采样点 / 分段', `${s.points} 点 / ${s.parts} 段`]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p className="route-note">按原始坐标和逐点时间统计，不跨断点计算速度。移动按区间速度≥1 km/h估算；起止跨度包含暂停和缺测，不能据此判断中断原因。高程未滤除GPS波动。</p>
    {!track.samples?.some(line => line.some(p => p.time !== null)) && <p role="status">这条旧记录缺少逐点时间，无法还原用时或速度。</p>}
  </section>;
}
