import { useId, useState } from 'react';
import { ChevronDown, ChevronUp, MapPin, Share2 } from 'lucide-react';
import type { DetailedPlaceSearch } from './usePlaceSearch';
import { formatDistance, metresBetween, type Coordinate, type RoutePlace } from './types';
import type { PlaceSearchSource } from './provider';
import { orderSearchResults } from './searchResultOrder';

const precisionLabels: Record<string, string> = {
  address: '门牌地址', poi: '地点', street: '街道', locality: '地区', region: '行政区', unknown: '精度未知',
};

function placeSource(place: RoutePlace) {
  return place.source === 'tianditu' ? '天地图' : place.source === 'photon' ? 'Photon / OSM' : place.source === 'offline' ? '离线' : '来源未标注';
}

function selectedSource(source: PlaceSearchSource) {
  return source === 'tianditu' ? '天地图' : source === 'photon' ? 'Photon / OSM' : '自动搜索';
}

export function PlaceResultList({
  places,
  near,
  onSelect,
  onExpandDetail,
  onNavigate,
  onShare,
  route = false,
  query = '',
}: {
  places: RoutePlace[];
  near: Coordinate | null;
  onSelect: (place: RoutePlace) => void;
  onExpandDetail?: () => void;
  onNavigate?: (place: RoutePlace) => void;
  onShare?: (place: RoutePlace) => void;
  route?: boolean;
  query?: string;
}) {
  const ordered = orderSearchResults(places, query, near);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const id = useId();

  return <div className={`place-search-result-list${route ? ' is-route' : ''}`}>
    {ordered.map((place, index) => {
      const key = `${place.source ?? ''}-${place.coordinates.join(',')}-${place.name}`;
      const expanded = expandedKey === key;
      const detailId = `${id}-place-detail-${index}`;
      const coarse = place.precision === 'street' || place.precision === 'locality' || place.precision === 'region';
      const unknownPrecision = place.precision == null || place.precision === 'unknown';
      return <div className="place-search-result-row" key={key}>
        <button type="button" data-place-result onClick={() => onSelect(place)}>
          <MapPin size={15} aria-hidden="true" />
          <span>
            <span className={route ? undefined : 'place-result-name-distance'}>
              <strong>{place.name}</strong>
              {!route && near && <span className="place-result-distance">距地图中心 {formatDistance(metresBetween(near, place.coordinates))}</span>}
            </span>
            <small className="place-search-address">{place.detail || '未提供地址信息'}</small>
            <small className={`place-result-meta${coarse || unknownPrecision ? ' is-caution' : ''}`}>
              {precisionLabels[place.precision ?? 'unknown'] ?? '精度未知'}
              {coarse ? ' · 需在地图核对' : unknownPrecision ? ' · 位置待确认' : ''}
              {' · '}{placeSource(place)}
              {route && near && <> · 距地图中心 {formatDistance(metresBetween(near, place.coordinates))}</>}
            </small>
          </span>
        </button>
        <button
          type="button"
          className="place-result-details-toggle"
          aria-label={`${expanded ? '收起' : '展开'}地点详情：${place.name}`}
          aria-expanded={expanded}
          aria-controls={expanded ? detailId : undefined}
          onClick={() => {
            if (!expanded) onExpandDetail?.();
            setExpandedKey(expanded ? null : key);
          }}
        >
          {expanded ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
          <span>详情</span>
        </button>
        {expanded && <div className="place-result-expanded" id={detailId}>
          <strong>{place.name}</strong>
          <p>{place.detail || '未提供完整地址信息'}</p>
          <small>{precisionLabels[place.precision ?? 'unknown'] ?? '精度未知'} · {placeSource(place)} · {place.coordinateSystem ?? '坐标系未标注'}</small>
          {coarse && <small className="place-search-coarse">街道或行政区参考位置，请在地图核对，勿作精确门牌定位。</small>}
          {unknownPrecision && <small className="place-search-coarse">位置精度未知，请在地图上确认。</small>}
          {!route && (onNavigate || onShare) && <div className="place-result-actions">
            {onNavigate && <button className="place-search-go" type="button" aria-label={`去这里：${place.name}`} onClick={() => onNavigate(place)}>
              <MapPin size={15} aria-hidden="true" />去这里
            </button>}
            {onShare && <button className="place-search-share" type="button" aria-label={`分享地点：${place.name}`} onClick={() => onShare(place)}>
              <Share2 size={15} aria-hidden="true" />分享地点
            </button>}
          </div>}
        </div>}
      </div>;
    })}
  </div>;
}

export function SelectedPlaceCard({
  place,
  onNavigate,
  onShare,
  onReturn,
}: {
  place: RoutePlace;
  onNavigate?: (place: RoutePlace) => void;
  onShare?: (place: RoutePlace) => void;
  onReturn: () => void;
}) {
  const coarse = place.precision === 'street' || place.precision === 'locality' || place.precision === 'region';
  const unknownPrecision = place.precision == null || place.precision === 'unknown';
  return <section className="place-selected-place" aria-label="已选地点">
    <div className="place-selected-place-content">
      <strong>{place.name}</strong>
      <p>{place.detail || '未提供完整地址信息'}</p>
      <small>{precisionLabels[place.precision ?? 'unknown'] ?? '精度未知'} · {placeSource(place)} · {place.coordinateSystem ?? '坐标系未标注'}</small>
      {coarse && <small className="place-search-coarse">街道或行政区参考位置，请在地图核对，勿作精确门牌定位。</small>}
      {unknownPrecision && <small className="place-search-coarse">位置精度未知，请在地图上确认。</small>}
    </div>
    <div className="place-selected-place-actions">
      {onNavigate && <button className="place-search-go" type="button" aria-label={`去这里：${place.name}`} onClick={() => onNavigate(place)}>
        <MapPin size={15} aria-hidden="true" />去这里
      </button>}
      {onShare && <button className="place-search-share" type="button" aria-label={`分享地点：${place.name}`} onClick={() => onShare(place)}>
        <Share2 size={15} aria-hidden="true" />分享地点
      </button>}
      <button className="place-selected-place-return" type="button" aria-label="重新搜索/返回结果" onClick={onReturn}>
        <ChevronDown size={15} aria-hidden="true" />重新搜索 / 返回结果
      </button>
    </div>
  </section>;
}

export function SearchHistoryList({
  entries,
  onRestore,
  onRemove,
  onClear,
}: {
  entries: string[];
  onRestore: (query: string) => void;
  onRemove: (query: string) => void;
  onClear: () => void;
}) {
  if (!entries.length) return <p className="place-search-history-empty">输入地点名称，搜索记录会显示在这里。</p>;
  return <div className="place-search-history" aria-label="最近搜索">
    <div className="place-search-history-heading">
      <small>最近搜索</small>
      <button type="button" aria-label="清空搜索记录" onClick={onClear}>清空</button>
    </div>
    <ul>
      {entries.map((query) => <li key={query}>
        <button className="place-search-history-restore" type="button" aria-label={`重新搜索：${query}`} onClick={() => onRestore(query)}>{query}</button>
        <button className="place-search-history-remove" type="button" aria-label={`删除搜索记录：${query}`} onClick={() => onRemove(query)}>×</button>
      </li>)}
    </ul>
  </div>;
}

export function SearchFeedback({
  error,
  busy,
  warnings,
  suggestions,
  onSuggestion,
  hasResults,
}: {
  error: string;
  busy: boolean;
  warnings: string[];
  suggestions: DetailedPlaceSearch['suggestions'];
  onSuggestion: (suggestion: DetailedPlaceSearch['suggestions'][number]) => void;
  hasResults: boolean;
}) {
  return <div className="place-search-feedback" aria-live="polite">
    {busy && <output>正在搜索…</output>}
    {error && <output className="place-search-error">{error}</output>}
    {warnings.map((warning, index) => <output className="place-search-warning" key={`${warning}-${index}`}>{warning}</output>)}
    {!!suggestions.length && <div className="place-search-suggestions" aria-label="可尝试的地点">
      <small>{hasResults ? '也可尝试' : '建议搜索'}</small>
      {suggestions.map((suggestion, index) => <button type="button" data-place-result key={`${suggestion.query}-${suggestion.city ?? ''}-${index}`} onClick={() => onSuggestion(suggestion)}>
        {suggestion.label}{suggestion.city ? ` · ${suggestion.city}` : ''}
      </button>)}
    </div>}
  </div>;
}

export function SearchFooter({
  loadedCount,
  hasMore,
  busy,
  onLoadMore,
  source,
}: {
  loadedCount: number;
  hasMore: boolean;
  busy: boolean;
  onLoadMore: () => void;
  source: PlaceSearchSource;
}) {
  return <output className="place-search-footer" aria-live="polite">
    <small>{selectedSource(source)} · 已载 {loadedCount} 条{loadedCount > 0 ? ' · 可滚动查看' : ''}</small>
    {hasMore && <button type="button" className="place-search-more" disabled={busy} onClick={onLoadMore}>
      {busy ? '加载中…' : '加载更多'}
    </button>}
  </output>;
}
