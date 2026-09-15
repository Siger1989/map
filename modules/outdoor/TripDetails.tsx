import { PhotoThumbnail } from '../photos/PhotoThumbnail';
import { useState } from 'react';
import type { ManualTrack } from '../tracks/drawing';
import type { Annotation } from '../annotations/data';
import type { VisiblePhoto } from '../photos/storage';
import type { TrackLinePoint } from '../tracks/linePoint';
import { TrackColorProfile } from '../tracks/TrackColorProfile';
import { RouteAnalysisSummary } from '../routeAnalysis/RouteAnalysisSummary';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
import { linkedRouteMarkers } from '../tracks/routeInfo';
import { photosForTrack } from '../photos/trackPhotos';
import { formatDistance } from '../navigation/types';
import { tripStats, saveTripRoute } from './tripData';
import { TripGraphs } from './TripGraphs';
import './tripDetails.css';
const duration = (seconds: number | null) =>
  seconds === null
    ? '未记录'
    : `${Math.floor(seconds / 3600)}时${Math.floor((seconds % 3600) / 60)}分`;
export function TripDetails(p: {
  track: ManualTrack;
  markers: Annotation[];
  photos: VisiblePhoto[];
  onBack: () => void;
  onPoint: (v: TrackLinePoint) => void;
  onPhoto: (id: string) => void;
  onMarker: (id: string) => void;
  onScan: () => void;
  onShare: () => void;
  onNavigate: () => void;
  onHide: (hidden: boolean) => boolean;
  onDelete: () => boolean;
  onRoute: (id: string) => void;
  error: string;
}) {
  const [tab, setTab] = useState<'track' | 'data' | 'along' | 'more'>('track');
  const [conversion, setConversion] = useState(false),
    [created, setCreated] = useState<ManualTrack | null>(null);
  const [name, setName] = useState(`${p.track.name} 路线`),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const back = () => {
    if (created) {
      setCreated(null);
      p.onBack();
    } else if (conversion) setConversion(false);
    else if (confirm) setConfirm(false);
    else p.onBack();
  };
  const root = useRouteDialogFocus(back);
  const stats = tripStats(p.track),
    pictures = photosForTrack(p.track, p.photos),
    markers = linkedRouteMarkers(p.track, p.markers);
  return (
    <section
      ref={root}
      className="trip-details route-surface"
      role="dialog"
      aria-label="行程详情"
      aria-modal="false"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header>
        <button onClick={back}>返回</button>
        <strong>{p.track.name}</strong>
        <button aria-label="行程更多" onClick={() => setTab('more')}>
          ⋯
        </button>
      </header>
      <nav className="trip-tabs">
        {(['track', 'data', 'along'] as const).map((t, i) => (
          <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {['轨迹', '数据', '沿途'][i]}
          </button>
        ))}
      </nav>
      <div className="trip-detail-scroll">
        {tab === 'track' && (
          <>
            <strong>
              {formatDistance(stats.distance)} · {duration(stats.duration)} ·
              均速 {stats.average?.toFixed(1) ?? '—'} km/h
            </strong>
            <TripGraphs track={p.track} onPoint={p.onPoint} />
            <details>
              <summary>分段资料与原轨迹图</summary>
              <TrackColorProfile track={p.track} lines={p.track.segments} />
            </details>
          </>
        )}
        {tab === 'data' && (
          <>
            <dl className="route-data-rows">
              {[
                [
                  '记录开始',
                  stats.start === null
                    ? '无时间'
                    : new Date(stats.start).toLocaleString('zh-CN'),
                ],
                [
                  '最后采样',
                  stats.end === null
                    ? '无时间'
                    : new Date(stats.end).toLocaleString('zh-CN'),
                ],
                [
                  '记录结束',
                  p.track.finishedAt
                    ? new Date(p.track.finishedAt).toLocaleString('zh-CN')
                    : '未单独记录',
                ],
                ['总里程', formatDistance(stats.distance)],
                ['总用时', duration(stats.duration)],
                ['有效采样时长', duration(stats.sampledSeconds)],
                [
                  '有效区间均速',
                  stats.average === null
                    ? '数据不足'
                    : `${stats.average.toFixed(1)} km/h`,
                ],
                [
                  '最高区间速度',
                  stats.maximum === null
                    ? '数据不足'
                    : `${stats.maximum.toFixed(1)} km/h`,
                ],
                [
                  '轨迹点',
                  `${p.track.segments.flat().length} 点 · ${p.track.segments.length} 段`,
                ],
              ].map(([a, b]) => (
                <div key={a}>
                  <dt>{a}</dt>
                  <dd>{b}</dd>
                </div>
              ))}
            </dl>
            <small>
              用时按已有时间记录统计；有效采样排除断段和过长缺测，不等同精确运动/停留时长。
            </small>
            <RouteAnalysisSummary track={p.track} />
          </>
        )}
        {tab === 'along' && (
          <>
            <strong>
              标记 {markers.length} · 照片 {pictures.length}
            </strong>
            {markers.map((m) => (
              <button
                className="trip-list-row"
                key={m.id}
                onClick={() => p.onMarker(m.id)}
              >
                {m.name || '未命名标记'}{' '}
                <span>
                  {m.trackAnchor
                    ? formatDistance(m.trackAnchor.distance)
                    : '沿途'}
                </span>
              </button>
            ))}
            <div className="route-detail-photos">
              {pictures.map((photo) => (
                <button key={photo.id} onClick={() => p.onPhoto(photo.id)}>
                  <PhotoThumbnail
                    id={photo.id}
                    src={photo.url || undefined}
                    alt={photo.name}
                  />
                  <small>
                    {new Date(photo.time).toLocaleTimeString('zh-CN', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                </button>
              ))}
            </div>
            <button onClick={p.onScan}>自动关联行程照片</button>
          </>
        )}
        {tab === 'more' &&
          (!conversion && !created && !confirm ? (
            <div className="trip-more">
              <button onClick={() => setConversion(true)}>转为路线</button>
              <button onClick={p.onNavigate}>导航</button>
              <button onClick={p.onShare}>分享 / 导出</button>
              <button onClick={() => p.onHide(!p.track.hidden)}>
                {p.track.hidden ? '恢复显示' : '隐藏行程'}
              </button>
              <button onClick={() => setConfirm(true)}>删除行程…</button>
            </div>
          ) : created ? (
            <>
              <strong>路线已生成</strong>
              <p>要隐藏原行程吗？原始时间、速度、照片保留在收藏。</p>
              <button onClick={() => p.onRoute(created.id)}>保留显示</button>
              <button
                onClick={() => {
                  if (p.onHide(true)) p.onRoute(created.id);
                }}
              >
                隐藏行程
              </button>
            </>
          ) : confirm ? (
            <>
              <p>删除此行程？关联照片、标记与转换后的路线保留。</p>
              <button onClick={() => setConfirm(false)}>取消</button>
              <button onClick={p.onDelete}>确认删除</button>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                try {
                  setCreated(saveTripRoute(p.track, name));
                  setConversion(false);
                  setError('');
                } catch (e) {
                  setError(e instanceof Error ? e.message : '生成失败');
                }
              }}
            >
              <label>
                路线名称
                <input
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <small>
                复制空间路径与海拔，历史时间和照片关联继续归原行程。
              </small>
              <button type="submit">生成路线</button>
              <button type="button" onClick={() => setConversion(false)}>
                取消
              </button>
            </form>
          ))}
        {(error || p.error) && <p role="alert">{error || p.error}</p>}
      </div>
    </section>
  );
}
