import { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, MapPin, Search } from 'lucide-react';
import { searchPlaces } from './provider';
import {
  formatDistance,
  formatDuration,
  metresBetween,
  TRAVEL_MODES,
  type Coordinate,
  type Endpoint,
  type PlannedRoute,
  type RoutePlace,
} from './types';
import type { NavigationState } from './useNavigation';

export function RoutePanel({
  navigation: n,
  near,
  onPick,
  onPlace,
  onShow,
  onSave,
  saveMessage,
  onCurrentPosition,
  locating,
}: {
  navigation: NavigationState;
  near: Coordinate;
  onPick: (slot: Endpoint) => void;
  onPlace: (place: RoutePlace) => void;
  onShow: (route: PlannedRoute) => void;
  onSave: () => void;
  saveMessage: string;
  onCurrentPosition: () => void;
  locating: boolean;
}) {
  const [target, setTarget] = useState<Endpoint>('start');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RoutePlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const editSearch = () => {
    abort.current?.abort();
    setSearching(false);
    setResults([]);
    setSearchError('');
  };
  const snapped =
    n.route && n.start && n.end
      ? Math.max(
          ...[n.start, n.end].map((p, i) =>
            n.route!.snapped[i]
              ? metresBetween(p.coordinates, n.route!.snapped[i])
              : 0,
          ),
        )
      : 0;
  return (
    <div className="route-panel">
      <div className="route-modes" aria-label="出行方式">
        {TRAVEL_MODES.map((mode) => (
          <button
            key={mode.id}
            aria-pressed={n.mode === mode.id}
            onClick={() => n.setMode(mode.id)}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <div className="route-endpoints">
        {(['start', 'end'] as const).map((slot, i) => (
          <div className="route-endpoint" key={slot}>
            <span className={`route-dot ${slot}`}>{i ? '终' : '起'}</span>
            <button
              className="route-place"
              title={n[slot]?.name}
              onClick={() => {
                editSearch();
                setTarget(slot);
                setQuery('');
              }}
            >
              {n[slot]?.name ?? `搜索${i ? '终' : '起'}点或地图选点`}
            </button>
            <button
              className="icon-button"
              aria-label={`在地图选择${i ? '终' : '起'}点`}
              onClick={() => onPick(slot)}
            >
              <MapPin size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="route-edit-actions">
        <button disabled={locating} onClick={onCurrentPosition}>
          {locating ? '正在定位…' : '当前位置作起点'}
        </button>
        <button onClick={n.swap}>
          <ArrowDownUp size={13} />
          交换起终点
        </button>
        <button onClick={n.clear}>清除路线</button>
      </div>
      <form
        className="route-search"
        onSubmit={async (event) => {
          event.preventDefault();
          abort.current?.abort();
          const controller = new AbortController();
          abort.current = controller;
          setSearching(true);
          setSearchError('');
          setResults([]);
          try {
            const places = await searchPlaces(query, near, controller.signal);
            if (!controller.signal.aborted) {
              setResults(places);
              if (!places.length)
                setSearchError('没有找到地点，可直接在地图选点。');
            }
          } catch (e) {
            if (!controller.signal.aborted)
              setSearchError(
                e instanceof Error && e.name !== 'TypeError'
                  ? e.message
                  : '搜索服务暂不可用，可直接在地图选点。',
              );
          } finally {
            if (!controller.signal.aborted) setSearching(false);
          }
        }}
      >
        <label htmlFor="route-search-target">搜索</label>
        <select
          id="route-search-target"
          value={target}
          onChange={(e) => {
            editSearch();
            setTarget(e.target.value as Endpoint);
          }}
        >
          <option value="start">起点</option>
          <option value="end">终点</option>
        </select>
        <input
          aria-label="搜索地点名称"
          placeholder="如：成都、都江堰"
          value={query}
          maxLength={120}
          onChange={(e) => {
            editSearch();
            setQuery(e.target.value);
          }}
        />
        <button
          className="icon-button"
          type="submit"
          disabled={searching || query.trim().length < 2}
          aria-label={searching ? '正在搜索' : '搜索地点'}
        >
          <Search size={16} />
        </button>
      </form>
      {searchError && (
        <p className="route-error" role="status">
          {searchError}
        </p>
      )}
      {!!results.length && (
        <ul className="route-search-results">
          {results.map((place, i) => (
            <li key={i}>
              <button
                onClick={() => {
                  n.place(target, place);
                  onPlace(place);
                  setResults([]);
                  setQuery('');
                  if (target === 'start') setTarget('end');
                }}
              >
                <strong>{place.name}</strong>
                <small>{place.detail}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="route-primary"
        disabled={n.loading || !n.start || !n.end}
        onClick={async () => {
          const route = await n.calculate();
          if (route) onShow(route);
        }}
      >
        {n.loading ? '正在计算道路路线…' : '规划路线'}
      </button>
      {n.error && (
        <p className="route-error" role="alert">
          {n.error}
        </p>
      )}
      {n.route && (
        <>
          <div className="route-result">
            <strong>{formatDistance(n.route.distance)}</strong>
            <span>预计 {formatDuration(n.route.duration)}</span>
            <button onClick={() => onShow(n.route!)}>看全程</button>
            <button onClick={onSave}>收藏路线</button>
          </div>
          {saveMessage && (
            <p className="route-note" role="status">
              {saveMessage}
            </p>
          )}
          {snapped > 100 && (
            <p className="route-error">
              起终点已匹配附近道路，最大偏移 {Math.round(snapped)}{' '}
              米；选点到道路间的路段未计入。
            </p>
          )}
          <details className="route-steps">
            <summary>查看转向与路段 · {n.route.steps.length} 步</summary>
            <ol>
              {n.route.steps.map((step, i) => (
                <li key={i}>
                  {step.instruction}
                  <small>{formatDistance(step.distance)}</small>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
      <p className="route-note">
        道路规划预估，不含实时路况和封路；左侧色带显示沿途模型天气，定位用于标记行程位置，尚无语音导航和偏航重算。
      </p>
      <p className="route-note">
        请求发送至{' '}
        <a
          href="https://valhalla.openstreetmap.de/"
          target="_blank"
          rel="noreferrer"
        >
          FOSSGIS / Valhalla
        </a>
        ，地名搜索由{' '}
        <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">
          Photon
        </a>{' '}
        提供。公共测试服务可能限流。地图数据 ©{' '}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          OpenStreetMap
        </a>{' '}
        ·{' '}
        <a
          href="https://www.openstreetmap.org/fixthemap"
          target="_blank"
          rel="noreferrer"
        >
          纠正地图
        </a>
      </p>
    </div>
  );
}
