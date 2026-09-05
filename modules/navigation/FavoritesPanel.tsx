import { formatDistance, formatDuration, TRAVEL_MODES } from './types';
import type { RouteFavorite } from './favorites';
import type { RouteFavoritesState } from './useRouteFavorites';
import type { ManualTracksState } from '../tracks/useManualTracks';
import { trackDistance } from '../tracks/drawing';
export function FavoritesPanel({
  favorites: f,
  tracks,
  onRoute,
  onTrack,
}: {
  favorites: RouteFavoritesState;
  tracks: ManualTracksState;
  onRoute: (item: RouteFavorite) => void;
  onTrack: (id: string) => void;
}) {
  return (
    <section className="route-favorites" aria-label="路线收藏夹">
      <strong>道路路线 · {f.items.length}/20</strong>
      {!f.items.length && (
        <p className="route-note">规划路线后点“收藏路线”，下次可直接打开。</p>
      )}
      {f.items.map((item) => (
        <div key={item.id} className="track-saved">
          <button className="track-open" onClick={() => onRoute(item)}>
            <strong>{item.name}</strong>
            <small>
              {TRAVEL_MODES.find((m) => m.id === item.route.mode)?.label} ·{' '}
              {formatDistance(item.route.distance)} ·{' '}
              {formatDuration(item.route.duration)}
            </small>
            <small>
              收藏于 {new Date(item.savedAt).toLocaleDateString('zh-CN')}
            </small>
          </button>
          <button
            className="track-delete"
            onClick={() => f.remove(item.id)}
            aria-label={`移除收藏 ${item.name}`}
          >
            移除
          </button>
        </div>
      ))}
      {f.message && (
        <p className="route-note" role="status">
          {f.message}
        </p>
      )}
      <strong className="journey-subtitle">
        手绘线路 · {tracks.saved.length}/20
      </strong>
      {!tracks.saved.length && (
        <p className="route-note">手绘线路保存后也会列在这里。</p>
      )}
      {tracks.saved.map((track) => (
        <div className="track-saved" key={track.id}>
          <button className="track-open" onClick={() => onTrack(track.id)}>
            <strong>{track.name}</strong>
            <small>{formatDistance(trackDistance(track.segments))}</small>
          </button>
        </div>
      ))}
      <p className="route-note">
        收藏保存在本机；清除应用数据会丢失。收藏的道路路线是保存时的计算结果，需要最新结果时重新规划。
      </p>
    </section>
  );
}
