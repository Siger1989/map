import { Mountain } from 'lucide-react';
import type { LayerSettings } from '../map/types';

export function LayerPresets({
  settings,
  onChange,
}: {
  settings: LayerSettings;
  onChange: (patch: Partial<LayerSettings>) => void;
}) {
  return (
    <div className="view-presets" aria-label="观察模式">
      <button
        aria-pressed={settings.terrain && settings.contours}
        onClick={() => onChange({ terrain: true, contours: true })}
      >
        <Mountain size={18} />
        看清地形
      </button>
    </div>
  );
}
