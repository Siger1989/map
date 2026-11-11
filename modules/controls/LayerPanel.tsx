import { useState } from 'react';
import {
  Layers,
  Mountain,
  Satellite,
  Spline,
  Route,
  MapPin,
  Palette,
  ChevronRight,
} from 'lucide-react';
import type { LayerSettings } from '../map/types';
import { CONTOUR_INTERVALS, contourInterval } from '../terrain/contourInterval';
import { basemapConfiguration } from '../cartography/basemaps';
import { usesSentinel, usesTianditu } from '../cartography/sentinel';
import { MapSwitch } from '../ui/MapSwitch';
import './layerParameters.css';
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
    key: 'elevationColors',
    label: '海拔着色',
    detail: '固定25米色带 · 不随等高距变化',
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
    key: 'outdoorContours',
    label: '户外等高线',
    detail: '黑底细黄绿线 · 保留原图层设置',
    icon: Mountain,
    color: 'green',
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
] as const;
export function LayerPanel({
  settings,
  onChange,
  satelliteDate,
  satelliteStatus,
  onOpenSources,
  customSource,
  onGeologyDetails,
}: {
  settings: LayerSettings;
  onChange: (patch: Partial<LayerSettings>) => void;
  satelliteDate?: string;
  satelliteStatus?: string;
  onOpenSources?: () => void;
  customSource?: string;
  onGeologyDetails?: () => void;
}) {
  const [expandedLayer, setExpandedLayer] = useState<
    (typeof ITEMS)[number]['key'] | null
  >(null);
  const domestic = usesTianditu(settings, basemapConfiguration().domestic);
  const nativeMapAvailable =
    typeof window !== 'undefined' &&
    typeof window.ShantuNativeMap?.postMessage === 'function';
  const parameters = (key: (typeof ITEMS)[number]['key']) => (
    <div className="layer-display-content">
      {key === 'elevationColors' && settings.elevationColors && (
        <div className="elevation-opacity">
          <label className="slider-label" htmlFor="elevation-colors-opacity">
            海拔着色不透明度{' '}
            <span>
              {Math.round((settings.elevationColorsOpacity ?? 1) * 100)}%
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
      {key === 'contours' && settings.contours && (
        <div className="elevation-opacity contour-interval">
          <label htmlFor="contour-interval">等高线高差间隔</label>
          <select
            id="contour-interval"
            value={contourInterval(settings.contourInterval)}
            onChange={(e) =>
              onChange({
                contourInterval: contourInterval(Number(e.target.value)),
              })
            }
          >
            {CONTOUR_INTERVALS.map((value) => (
              <option key={value} value={value}>
                {value}米{value === 30 ? ' · 最细' : ''}
              </option>
            ))}
          </select>
          <small>
            所选高差只控制等高线间隔和远景最低显示缩放级别；填色固定25米细分，不随等高距变化。线旁数值为海拔米数。
          </small>
        </div>
      )}
      {key === 'roads' && (
        <div className="elevation-opacity">
          <label className="slider-label" htmlFor="roads-opacity">
            道路/注记不透明度{' '}
            <span>{Math.round((settings.roadsOpacity ?? 1) * 100)}%</span>
          </label>
          <input
            id="roads-opacity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.roadsOpacity ?? 1}
            onChange={(e) => onChange({ roadsOpacity: Number(e.target.value) })}
          />
          <p>
            0% 隐藏，100%
            正常显示。天地图道路/地名注记一起变化；矢量底图内的道路不能单独分离。
          </p>
        </div>
      )}
      {key === 'satellite' && !customSource && settings.satellite && (
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
      {key === 'geology' && settings.geology && (
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
            {onGeologyDetails && (
              <button
                type="button"
                className="layer-geology-detail"
                onClick={onGeologyDetails}
              >
                地质图例与说明
              </button>
            )}
          </div>
        </>
      )}
      {key === 'terrain' && settings.terrain && (
        <div className="panel-sliders">
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
      )}
    </div>
  );
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
          ({ key, label, detail, icon: Icon, color }) => {
            const hasParameters =
              key === 'roads' ||
              ([
                'terrain',
                'satellite',
                'elevationColors',
                'contours',
                'geology',
              ].includes(key) &&
                settings[key]);
            const expanded = expandedLayer === key;
            return (
              <div className="layer-item" data-layer={key} key={key}>
                <div className="layer-row">
                  <div className={`layer-icon ${color}`}>
                    <Icon size={18} />
                  </div>
                  <div className="layer-text">
                    <label
                      id={`${key}-label`}
                      htmlFor={`${key}-toggle`}
                      title={
                        key === 'elevationColors'
                          ? '海拔着色 · 固定25米细分；等高距只控制等高线'
                          : detail
                      }
                    >
                      {label}
                    </label>
                    {key === 'satellite' && settings.satellite && (
                      <p>
                        {key === 'satellite'
                          ? settings.imageryMode === 'detail'
                            ? usesSentinel(settings)
                              ? 'Sentinel-2 · 2025年合成 · 约10米'
                              : domestic
                                ? '天地图地表影像 · 非实时云况'
                                : '10 米级地表 · 2025 年合成'
                            : satelliteDate
                              ? `影像日期 ${satelliteDate}`
                              : '正在获取最新可用日期'
                          : detail}
                      </p>
                    )}
                    {key === 'outdoorContours' && settings.outdoorContours && (
                      <p>
                        {nativeMapAvailable
                          ? '放大后查看真实等高线；高程未加载处暂时留空。切回后恢复原图层显示。'
                          : '此模式仅由 Android 原生地图支持；网页不模拟绘制，也不生成虚假地形。'}
                      </p>
                    )}
                  </div>
                  {hasParameters && (
                    <button
                      type="button"
                      className="layer-parameters-toggle"
                      aria-label={`${label}显示参数`}
                      aria-expanded={expanded}
                      aria-controls={`${key}-parameters`}
                      onClick={() => setExpandedLayer(expanded ? null : key)}
                    >
                      参数
                      <ChevronRight size={12} aria-hidden="true" />
                    </button>
                  )}
                  <MapSwitch
                    inputId={`${key}-toggle`}
                    ariaLabelledBy={`${key}-label`}
                    label={null}
                    checked={Boolean(settings[key])}
                    onChange={(checked) => onChange({ [key]: checked })}
                    size="map"
                    className="layer-panel-switch"
                  />
                </div>
                {hasParameters && (
                  <div
                    id={`${key}-parameters`}
                    className="layer-parameters"
                    role="region"
                    aria-label={`${label}显示参数`}
                    hidden={!expanded}
                  >
                    {parameters(key)}
                  </div>
                )}
              </div>
            );
          },
        )}
      </div>
      <div className="layer-settings-actions">
        <details className="layer-help">
          <summary aria-label="图层说明与数据来源">说明与来源</summary>
          <ul>
            {ITEMS.map(({ key, label, detail }) => (
              <li key={key}>
                <b>{label}</b> · {detail}
              </li>
            ))}
          </ul>
          <p className="satellite-note" role="status">
            {domestic
              ? '底图与中文标注：天地图。道路吸附及区域外高程仍可能需要境外连接。'
              : settings.imageryMode === 'detail'
                ? 'EOX / Sentinel-2 · 2025 年少云合成，约10米，非实时影像。免账号，CC BY-NC-SA 4.0非商业使用；区域下载待接入。'
                : `${satelliteStatus || '正在查询卫星影像…'}。此观测包含真实云层，云多时会遮住地表；看山体纹理请选择高清地表。`}
          </p>
        </details>
      </div>
    </section>
  );
}
