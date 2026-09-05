import {
  Cloud,
  CloudRain,
  Info,
  Layers,
  Mountain,
  Satellite,
  Spline,
  Route,
  MapPin,
} from 'lucide-react';
import type { LayerSettings } from '../map/types';
const ITEMS = [
  {
    key: 'terrain',
    label: '三维地形',
    detail: '真实山体与地表起伏',
    icon: Mountain,
    color: 'green',
  },
  {
    key: 'satellite',
    label: '卫星影像',
    detail: '地表影像 · 独立日期',
    icon: Satellite,
    color: 'blue',
  },
  {
    key: 'contours',
    label: '海拔等高线',
    detail: '沿线标注高度，单位米',
    icon: Spline,
    color: 'amber',
  },
  {
    key: 'roads',
    label: '道路与河流',
    detail: '公路 · 铁路 · 路名',
    icon: Route,
    color: 'amber',
  },
  {
    key: 'labels',
    label: '地名与山峰',
    detail: '城市 · 区县 · 乡镇',
    icon: MapPin,
    color: 'green',
  },
  {
    key: 'clouds',
    label: '立体云层',
    detail: '低 / 中 / 高云 · 模型示意',
    icon: Cloud,
    color: 'white',
  },
  {
    key: 'rain',
    label: '降雨动画',
    detail: '雨区与强度 · 模型示意',
    icon: CloudRain,
    color: 'cyan',
  },
] as const;
export function LayerPanel({
  settings,
  onChange,
  satelliteDate,
  satelliteStatus,
}: {
  settings: LayerSettings;
  onChange: (patch: Partial<LayerSettings>) => void;
  satelliteDate?: string;
  satelliteStatus?: string;
}) {
  return (
    <aside className="layer-panel glass" aria-label="地图图层">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">YOUR VIEW</span>
          <h2>
            <Layers size={19} />
            图层控制
          </h2>
        </div>
        <span className="layer-count">
          {ITEMS.filter(({ key }) => settings[key]).length} / {ITEMS.length}
        </span>
      </div>
      <div className="layer-list">
        {ITEMS.map(({ key, label, detail, icon: Icon, color }) => (
          <div className="layer-row" key={key}>
            <div className={`layer-icon ${color}`}>
              <Icon size={21} />
            </div>
            <div className="layer-text">
              <label id={`${key}-label`} htmlFor={`${key}-toggle`}>
                {label}
              </label>
              <p>
                {key === 'satellite'
                  ? settings.imageryMode === 'detail'
                    ? '10 米级地表 · 2024 年合成'
                    : satelliteDate
                      ? `影像日期 ${satelliteDate}`
                      : '正在获取最新可用日期'
                  : detail}
              </p>
            </div>
            <button
              id={`${key}-toggle`}
              type="button"
              className="switch"
              role="switch"
              aria-checked={settings[key]}
              aria-labelledby={`${key}-label`}
              onClick={() => onChange({ [key]: !settings[key] })}
            >
              <span />
            </button>
          </div>
        ))}
      </div>
      <div className="imagery-selector" aria-label="卫星影像类型">
        <button
          aria-pressed={settings.imageryMode === 'detail'}
          onClick={() => onChange({ imageryMode: 'detail', satellite: true })}
        >
          高清地表
        </button>
        <button
          aria-pressed={settings.imageryMode === 'latest'}
          onClick={() => onChange({ imageryMode: 'latest', satellite: true })}
        >
          最新观测
        </button>
      </div>
      <div className="panel-sliders">
        <label className="slider-label" htmlFor="weather-opacity">
          云雨透明度 <span>{Math.round(settings.opacity * 100)}%</span>
        </label>
        <input
          id="weather-opacity"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={settings.opacity}
          onChange={(e) => onChange({ opacity: Number(e.target.value) })}
        />
        <label className="slider-label" htmlFor="terrain-exaggeration">
          地形起伏增强 <span>{settings.exaggeration.toFixed(1)}×</span>
        </label>
        <input
          id="terrain-exaggeration"
          type="range"
          min="1"
          max="2"
          step="0.1"
          disabled={!settings.terrain}
          value={settings.exaggeration}
          onChange={(e) => onChange({ exaggeration: Number(e.target.value) })}
        />
      </div>
      <p className="satellite-note" role="status">
        {settings.imageryMode === 'detail'
          ? 'EOX / Sentinel-2 · 2024 年无云合成。10 米级影像适合看地表细节；当天云况请切换最新观测。'
          : satelliteStatus || '正在查询卫星影像…'}
      </p>
      <div className="layer-note">
        <Info size={15} />
        <p>云的高度与形态为简化示意。数值以数据面板为准。</p>
      </div>
    </aside>
  );
}
