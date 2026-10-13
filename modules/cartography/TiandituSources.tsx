import { DEFAULT_TIANDITU_LABELS, type LayerSettings } from '../map/types';
import { tiandituBase, TIANDITU_LAYERS, usesVectorPlaceLabels } from './tianditu';
import { usesSentinel } from './sentinel';
import { FavoriteSourceStar } from '../mapSources/FavoriteSourceStar';
export function TiandituSources({
  settings,
  onChange,
  active = true,
}: {
  settings: LayerSettings;
  onChange: (patch: Partial<LayerSettings>) => void;
  active?: boolean;
}) {
  return (
    <section className="tianditu-sources" aria-label="内置图源">
      <div className="map-source-builtins map-source-primary-grid">
      <div className="tianditu-source-choice"><button aria-pressed={active && usesSentinel(settings)} onClick={() => onChange({satellite:true,satelliteProvider:'sentinel',imageryMode:'detail',offlineBasemap:false,offlineMaxZoom:null,rasterLevel:null})}>Sentinel-2 2025</button><FavoriteSourceStar sourceKey="sentinel" name="Sentinel-2 2025" group="builtin" /></div>
        {(['vec', 'img', 'ter'] as const).map((id) => (
          <div className="tianditu-source-choice" key={id}>
          <button
            aria-pressed={
              active && settings.satelliteProvider === 'tianditu' &&
              tiandituBase(settings) === id &&
              !settings.offlineBasemap
            }
            onClick={() =>
              onChange({
                tiandituBase: id,
                satelliteProvider: 'tianditu',
                rasterLevel: null,
                offlineMaxZoom: null,
              })
            }
          >
            {id === 'img' ? '天地图影像' : TIANDITU_LAYERS[id].name}
          </button>
          <FavoriteSourceStar sourceKey={`tdt-${id}`} name={id === 'img' ? '天地图影像' : TIANDITU_LAYERS[id].name} group="builtin" />
          </div>
        ))}
      </div>
      <small>{settings.satelliteProvider === 'tianditu' ? usesVectorPlaceLabels(settings) ? '地名：OpenStreetMap · 覆盖可能不同' : '天地图 · 高清备用 · 有每日额度' : '默认 · 约10米 · 非商业使用 · 下载待接入'}</small>
      {settings.satelliteProvider === 'tianditu' && <div className="tianditu-options">
        <label>
          <select
            aria-label="地名注记"
            value={
              settings.labels ? (settings.tiandituLabels ?? DEFAULT_TIANDITU_LABELS) : 'none'
            }
            onChange={(e) =>
              onChange({
                tiandituLabels: e.target
                  .value as LayerSettings['tiandituLabels'],
                labels: e.target.value !== 'none',
              })
            }
          >
            <option value="vector">清晰文字（默认）</option>
            <option value="auto">原图注记（自动）</option>
            <option value="cva">矢量注记</option>
            <option value="cia">影像注记</option>
            <option value="cta">地形注记</option>
            <option value="none">关闭注记</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings.tiandituBoundaries ?? false}
            onChange={(e) => onChange({ tiandituBoundaries: e.target.checked })}
          />
          全球境界
        </label>
      </div>}
    </section>
  );
}
