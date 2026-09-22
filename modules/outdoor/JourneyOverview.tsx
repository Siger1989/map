import { useState } from 'react';
import { Footprints, MoreHorizontal, LocateFixed, Settings2, Images, ChevronLeft } from 'lucide-react';
import { type ManualTrack, trackDistance } from '../tracks/drawing';
import { hasTrackTime, trackSourceLabel } from '../tracks/provenance';
import { formatDistance, type Coordinate } from '../navigation/types';
import { trackHeights } from '../routeAnalysis/trackElevation';
import { elevationStats } from '../journey/metrics';
import { ColorElevation } from '../tracks/ColorElevation';
import { RouteAnalysisSummary } from '../routeAnalysis/RouteAnalysisSummary';

/** First journey layer. Read existing tracks; deeper tools retain their own screens. */
export function JourneyOverview({ tracks, selectedId, recordingStarted, onSelect, onShow, onRecord, onPhotos, onTool }: {
  tracks: ManualTrack[]; selectedId: string | null;
  recordingStarted: boolean;
  onSelect: (id: string) => void; onShow: (points: Coordinate[]) => void;
  onRecord: () => void; onPhotos: () => void;
  onTool: (tool: 'files' | 'offline' | 'return') => void;
}) {
  const [tab, setTab] = useState<'track' | 'data' | 'along'>('track');
  const [more, setMore] = useState(false);
  const journeys = tracks.filter(t => t.source === 'recorded' || hasTrackTime(t));
  const track = journeys.find(t => t.id === selectedId) ?? journeys[0];
  const heights = track ? trackHeights(track) : [];
  const stats = elevationStats(heights);
  const times = track?.samples?.flat().map(p => p.time).filter((t): t is number => t !== null && Number.isFinite(t)) ?? [];
  const time = (t: number | undefined) => t === undefined ? '未记录' : new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const metres = (n: number | null) => n === null ? '—' : `${Math.round(n)} m`;
  return <section className="journey-overview" aria-label="行程概览">
    <header className="journey-title-row">
      <Footprints size={18} aria-hidden="true" />
      {track ? <select aria-label="选择行程" value={track.id} onChange={e => { onSelect(e.target.value); setMore(false); }}>
        {journeys.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select> : <strong>我的行程</strong>}
      <button aria-label="行程更多操作" aria-expanded={more} onClick={() => setMore(!more)}><MoreHorizontal size={20} /></button>
    </header>
    {!more && <button className="journey-record-entry" onClick={onRecord}><Footprints size={16} />{recordingStarted ? '当前实走记录' : '新建实走记录'}</button>}
    {more ? <nav className="journey-more" aria-label="行程更多">
      <button onClick={() => setMore(false)}><ChevronLeft size={16} />返回行程</button>
      <button onClick={onRecord}><Settings2 size={16} />实走记录与设置</button>
      <button onClick={() => onTool('files')}>导入 / 导出数据</button>
      <button onClick={() => onTool('offline')}>离线地图</button>
    </nav> : <>
      {track && <div className="journey-summary"><span>{formatDistance(trackDistance(track.segments))}</span><span>{trackSourceLabel(track)}</span><span>{times.length ? time(times[0]) : '未记录时间'}</span></div>}
      {track && <nav className="journey-tabs" aria-label="行程内容">
        {(['track', 'data', 'along'] as const).map((id, i) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{['轨迹', '数据', '沿途'][i]}</button>)}
      </nav>}
      {!track ? <div className="journey-empty"><strong>还没有已保存行程</strong><p>完成实走记录后会显示在这里。</p><button onClick={() => onTool('files')}>导入历史记录</button></div> : <>
        {tab === 'track' && <>
          <div className="journey-track-actions"><span>海拔 {metres(stats.min)}–{metres(stats.max)}</span><button onClick={() => onShow(track.segments.flat())}><LocateFixed size={15} />查看全程</button></div>
          <div className="journey-profile-preview"><ColorElevation track={track} samples={heights} /></div>
          <p className="journey-hint">轨迹自带高程；分段资料可向下查看。</p>
        </>}
        {tab === 'data' && <div className="journey-data"><dl>
          {([['开始', time(times[0])], ['结束', time(times.at(-1))], ['里程', formatDistance(trackDistance(track.segments))], ['记录点', String(track.segments.flat().length)], ['累计爬升', metres(stats.ascent)], ['累计下降', metres(stats.descent)]]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl><RouteAnalysisSummary track={track} /></div>}
        {tab === 'along' && <div className="journey-along"><button onClick={() => { onSelect(track.id); onPhotos(); }}><Images size={18} />本行程照片</button><p>按所选行程查看、匹配照片。</p></div>}
      </>}
    </>}
  </section>;
}
