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
  Palette,
  ChevronRight,
  Thermometer,
} from 'lucide-react';
import type { LayerSettings } from '../map/types';
import { basemapConfiguration } from '../cartography/basemaps';
const ITEMS = [
  {
    key: 'temperature',
    label: '气温',
    detail: '2 米气温预报 · 当前区域颜色分布',
    icon: Thermometer,
    color: 'amber',
  },
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
    key: 'elevationColors',
    label: '海拔着色',
    detail: '500 米分色 · 海拔区间图例',
    icon: Palette,
    color: 'amber',
  },
  {
    key: 'contours',
    label: '海拔等高线',
    detail: '沿线标注高度，单位米',
    icon: Spline,
    color: 'amber',
  },
  {
    key: 'geology',
    label: '地质图投射',
    detail: '岩性 · 地层年代 · 构造线',
    icon: Layers,
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
  onOpenSources,
  customSource,
}: {
  settings: LayerSettings;
  onChange: (patch: Partial<LayerSettings>) => void;
  satelliteDate?: string;
  satelliteStatus?: string;
  onOpenSources?: () => void;
  customSource?: string;
}) {
  const domestic = basemapConfiguration().domestic;
  return (
    <section className="layer-panel" aria-label="地图图层">
      {onOpenSources && (
        <button
          className="map-source-link"
          onClick={onOpenSources}
          aria-label={`地图图源 · ${customSource || '内置地图'} · 选择 / 导入`}
        >
          <Layers size={16} />
          <span>{customSource || '内置地图'}</span>
          <ChevronRight size={16} />
        </button>
      )}
      <div className="layer-list">
        {ITEMS.filter(({ key }) => !customSource || key !== 'satellite').map(
          ({ key, label, detail, icon: Icon, color }) => (
            <div className="layer-row" key={key}>
              <div className={`layer-icon ${color}`}>
                <Icon size={18} />
              </div>
              <div className="layer-text">
                <label
                  id={`${key}-label`}
                  htmlFor={`${key}-toggle`}
                  title={detail}
                >
                  {label}
                </label>
                {key === 'satellite' && settings.satellite && (
                  <p>
                    {key === 'satellite'
                      ? settings.imageryMode === 'detail'
                        ? domestic
                          ? '天地图地表影像 · 非实时云况'
                          : '10 米级地表 · 2024 年合成'
                        : satelliteDate
                          ? `影像日期 ${satelliteDate}`
                          : '正在获取最新可用日期'
                      : detail}
                  </p>
                )}
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
              {key === 'elevationColors' && settings.elevationColors && (
                <div className="elevation-opacity">
                  <label
                    className="slider-label"
                    htmlFor="elevation-colors-opacity"
                  >
                    海拔着色不透明度{' '}
                    <span>
                      {Math.round((settings.elevationColorsOpacity ?? 1) * 100)}
                      %
                    </span>
                  </label>
                  <input
                    id="elevation-colors-opacity"
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.elevationColorsOpacity ?? 1}
                    aria-valuetext={`${Math.round((settings.elevationColorsOpacity ?? 1) * 100)}%${settings.elevationColorsOpacity === 0 ? '，完全透明' : ''}`}
                    onChange={(e) =>
                      onChange({
                        elevationColorsOpacity: Number(e.target.value),
                      })
                    }
                  />
                  <p>0% 完全透明，100% 完全显示。</p>
                </div>
              )}
              {key === 'geology' && settings.geology && (
                <div
                  className="elevation-opacity geology-source-choice"
                  role="group"
                  aria-label="地质图源"
                >
                  <button
                    aria-pressed={settings.geologySource === 'world'}
                    onClick={() => onChange({ geologySource: 'world' })}
                  >
                    全球地质
                  </button>
                  <button
                    aria-pressed={settings.geologySource === 'geocloud20w'}
                    onClick={() => onChange({ geologySource: 'geocloud20w' })}
                  >
                    1∶20 万 · 地质云
                  </button>
                </div>
              )}
            </div>
          ),
        )}
      </div>
      {!customSource && settings.satellite && (
        <div className="imagery-selector" aria-label="卫星影像类型">
          <button
            aria-pressed={settings.imageryMode === 'detail'}
            onClick={() => onChange({ imageryMode: 'detail', satellite: true })}
          >
            高清地表
          </button>
          <button
            aria-pressed={settings.imageryMode === 'latest'}
            disabled={domestic}
            onClick={() => onChange({ imageryMode: 'latest', satellite: true })}
          >
            最新云况影像
          </button>
        </div>
      )}
      {settings.geology && (
        <>
          <div className="geology-opacity">
            <label className="slider-label" htmlFor="geology-opacity">
              地质图不透明度{' '}
              <span>{Math.round(settings.geologyOpacity * 100)}%</span>
            </label>
            <input
              id="geology-opacity"
              type="range"
              min="0.15"
              max="1"
              step="0.05"
              value={settings.geologyOpacity}
              onChange={(e) =>
                onChange({ geologyOpacity: Number(e.target.value) })
              }
            />
            <p>地质着色与海拔着色互相切换，避免颜色混淆。</p>
          </div>
        </>
      )}
      <div className="panel-sliders">
        {(settings.clouds || settings.rain) && (
          <>
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
          </>
        )}
        {settings.terrain && (
          <>
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
              onChange={(e) =>
                onChange({ exaggeration: Number(e.target.value) })
              }
            />
          </>
        )}
      </div>
      <details className="layer-help">
        <summary>图层说明与数据来源</summary>
        <ul>
          {ITEMS.map(({ key, label, detail }) => (
            <li key={key}>
              <b>{label}</b> · {detail}
            </li>
          ))}
        </ul>
        <p className="satellite-note" role="status">
          {domestic
            ? '底图与中文标注：天地图。最新云况暂无国内替代；天气、道路吸附及区域外高程仍可能需要境外连接。'
            : settings.imageryMode === 'detail'
              ? 'EOX / Sentinel-2 · 2024 年无云合成。10 米级影像适合看地表细节；当天云况请切换最新观测。'
              : `${satelliteStatus || '正在查询卫星影像…'}。此观测包含真实云层，云多时会遮住地表；看山体纹理请选择高清地表。`}
        </p>
        <div className="layer-note">
          <Info size={15} />
          <p>云的高度与形态为简化示意。数值以数据面板为准。</p>
        </div>
      </details>
    </section>
  );
}
