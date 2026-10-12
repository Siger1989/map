import type { PlaceSearchSource } from './provider';
import './search.css';

export function SearchOptions({
  source,
  onSourceChange,
  city,
  onCityChange,
  nationwide,
  onNationwideChange,
}: {
  source: PlaceSearchSource;
  onSourceChange: (source: PlaceSearchSource) => void;
  city: string;
  onCityChange: (city: string) => void;
  nationwide: boolean;
  onNationwideChange: (value: boolean) => void;
}) {
  return (
    <div className="place-search-options-bar" aria-label="搜索选项">
      <label>
        <span>数据源</span>
        <select aria-label="搜索数据源" value={source} onChange={(event) => onSourceChange(event.target.value as PlaceSearchSource)}>
          <option value="auto">自动</option>
          <option value="tianditu">天地图</option>
          <option value="photon">全球 OSM</option>
        </select>
      </label>
      <label className="place-search-city">
        <span>城市偏好</span>
        <span className="place-search-city-field">
          <input aria-label="城市偏好，可选" value={city} maxLength={48} placeholder="可选" onChange={(event) => onCityChange(event.target.value)} />
          {!!city && <button type="button" aria-label="清除城市偏好" onClick={() => onCityChange('')}>清除</button>}
        </span>
      </label>
      <label className="place-search-national">
        <input type="checkbox" checked={nationwide} onChange={(event) => onNationwideChange(event.target.checked)} />
        <span>全国扩展</span>
      </label>
    </div>
  );
}
