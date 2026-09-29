import type { LayerSettings } from '../map/types';
import { COORDINATES_KEY, rasterDatumKey, type RasterDatum } from './coordinates';

export function RasterDatumChoice({ settings, selected, image, defaultDatum = 'wgs84', onChange, onError }: {
  settings: LayerSettings; selected?: string | null; image: boolean;
  defaultDatum?: RasterDatum;
  onChange: (patch: Partial<LayerSettings>) => void; onError: (message: string) => void;
}) {
  const key = rasterDatumKey(settings, selected ?? undefined);
  return <>
    <label className="map-coordinate-choice">
      <span>图源坐标系</span>
      <select aria-label="图源坐标系" disabled={image || (!selected && !settings.satellite && settings.satelliteProvider !== 'tianditu')}
        value={settings.rasterDatums?.[key] ?? 'auto'}
        onChange={e => {
          const rasterDatums = { ...settings.rasterDatums };
          if (e.target.value === 'auto') delete rasterDatums[key];
          else rasterDatums[key] = e.target.value as RasterDatum;
          onChange({ rasterDatums });
          try { localStorage.setItem(COORDINATES_KEY, JSON.stringify(rasterDatums)); }
          catch { onError('当前坐标选择未保存，重启后需重新选择'); }
        }}>
        <option value="auto">自动 · {{ wgs84: 'WGS84', gcj02: 'GCJ-02', bd09: 'BD-09' }[defaultDatum]}</option>
        <option value="wgs84">WGS84 · 无偏移</option>
        <option value="gcj02">GCJ-02 · 校正偏移</option>
        <option value="bd09">BD-09 · 校正偏移</option>
      </select>
    </label>
    <small className="map-coordinate-hint">{image ? 'GeoTIFF 请先重投影为 WGS84 再导入' : '自动识别已知模板，其余使用图源声明；手动选择只作用于当前图源'}</small>
  </>;
}
