import type { LayerSettings } from '../map/types';
import { tiandituBase, TIANDITU_LAYERS } from './tianditu';
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
    <section className="tianditu-sources" aria-label="天地图图源">
      <div className="map-source-builtins">
        {(['vec', 'img', 'ter'] as const).map((id) => (
          <button
            key={id}
            aria-pressed={
              active &&
              tiandituBase(settings) === id &&
              !settings.offlineBasemap
            }
            onClick={() =>
              onChange({
                tiandituBase: id,
                rasterLevel: null,
                offlineMaxZoom: null,
              })
            }
          >
            {TIANDITU_LAYERS[id].name}
          </button>
        ))}
      </div>
      <div className="tianditu-options">
        <label>
          <select
            aria-label="地名注记"
            value={
              settings.labels ? (settings.tiandituLabels ?? 'auto') : 'none'
            }
            onChange={(e) =>
              onChange({
                tiandituLabels: e.target
                  .value as LayerSettings['tiandituLabels'],
                labels: e.target.value !== 'none',
              })
            }
          >
            <option value="auto">匹配底图</option>
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
      </div>
    </section>
  );
}
