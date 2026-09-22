import { useMemo, useState } from 'react';
import { Mountain, ChevronRight, Navigation, Bookmark, Pencil, FileText } from 'lucide-react';
import type { ManualTrack } from './drawing';
import type { TrackLinePoint } from './linePoint';
import { trackAlternatives } from './alternatives';
import { useDockClearance } from './useDockClearance';
import { useTrackElevation } from '../routeAnalysis/useTrackElevation';
import { trackHeights } from '../routeAnalysis/trackElevation';
import { elevationStats } from '../journey/metrics';
import { formatDistance, formatDuration } from '../navigation/types';

/** Home summary only. Detailed point metrics remain in the existing route details. */
export function HomeRouteCard({ track, point, alternative, error, onBack, onNavigate, onMarker, onEdit, onDetails, onRename, onCache }: {
  track: ManualTrack; point: TrackLinePoint | null; alternative: string; error: string;
  onBack: () => void; onNavigate: () => void; onMarker: () => void; onEdit: () => void; onDetails: () => void;
  onRename: (name: string) => boolean;
  onCache?: () => void;
}) {
  const [name, setName] = useState<string | null>(null);
  const [renameError, setRenameError] = useState('');
  const dock = useDockClearance('--route-card-clearance');
  const choices = useMemo(() => trackAlternatives(track.segments), [track.segments]);
  const choice = choices.find(v => v.id === alternative) ?? choices[0];
  const elevation = useTrackElevation(track, true);
  const stats = useMemo(() => elevationStats(trackHeights(elevation.profile ?? track)), [elevation.profile, track]);
  // Reuse an available planned duration; don't invent a speed for imported tracks.
  const duration = track.sharedRoute?.duration;
  return <section ref={dock} className="home-route-card" aria-label="所选路线">
    {name !== null ? <form className="home-route-rename" aria-label="修改路线名称" onSubmit={event => {
      event.preventDefault();
      if (!name.trim()) { setRenameError('请输入路线名称'); return; }
      if (onRename(name)) { setName(null); setRenameError(''); }
      else setRenameError('名称未保存，请重试；输入已保留。');
    }}>
      <label htmlFor="home-route-name">路线名称</label>
      <input id="home-route-name" autoFocus value={name} maxLength={60}
        onFocus={event => event.currentTarget.select()}
        onChange={event => { setName(event.target.value); setRenameError(''); }}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setName(null); setRenameError(''); } }} />
      <div>
        <button type="button" onClick={() => { setName(null); setRenameError(''); }}>取消</button>
        <button className="is-primary" type="submit">保存名称</button>
      </div>
      {renameError && <p role="alert">{renameError}</p>}
    </form> : <><header>
      <Mountain className="home-route-symbol" size={23} aria-hidden="true" />
      <button className="home-route-name" title={track.name} aria-label={`修改路线名称：${track.name}`}
        onClick={() => { setName(track.name); setRenameError(''); }}>
        <strong>{track.name}</strong><span>改名</span>
      </button>
      <button className="home-route-back" onClick={onBack} aria-label="返回"><span>返回</span><ChevronRight size={17} /></button>
    </header>
    <div className="home-route-metrics">
      <span>{choice ? formatDistance(choice.distance) : '—'}</span>
      <span title={elevation.estimated ? '含地形估算' : '轨迹自带高程'}>爬升 {stats.ascent === null || choices.length > 1 ? '—' : `${Math.round(stats.ascent)} m`}</span>
      <span>{duration != null ? `预计 ${formatDuration(duration)}` : '用时 —'}</span>
    </div>
    <nav className="home-route-actions" aria-label="路线主要操作">
      <button className="is-primary" onClick={onNavigate}><Navigation size={18} fill="currentColor" />导航</button>
      <button disabled={!point} onClick={onMarker} aria-label="添加标记"><Bookmark size={18} />标记</button>
      <button onClick={onEdit}><Pencil size={18} />编辑</button>
      <button onClick={onDetails}><FileText size={18} />详情</button>
    </nav>{onCache&&<button className="home-route-cache" onClick={onCache}>缓存当前路线</button>}</>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
