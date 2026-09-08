import { useState } from 'react';
import { MapPinPlus } from 'lucide-react';
import type { Coordinate } from '../navigation/types';
import type { MapHandle } from './TerrainMap';
import './centerCursor.css';

/** The public map projection, not GPS, supplies the location under the reticle. */
export function CenterCursor({
  map,
  onAdd,
}: {
  map: () => MapHandle | null;
  onAdd: (point: Coordinate) => void;
}) {
  const [error, setError] = useState('');
  return (
    <>
      <div className="map-center-cursor" aria-hidden="true">
        <i />
        <b />
      </div>
      <button
        className="center-add glass"
        aria-label="在地图中心准星处添加标记"
        onClick={() => {
          const coordinate = map()?.centerCoordinate();
          if (!coordinate) {
            setError('准星下暂无可选地面，请移动地图后重试');
            return;
          }
          setError('');
          onAdd(coordinate);
        }}
      >
        <MapPinPlus size={18} />
        <span>加点</span>
      </button>
      {error && (
        <button
          className="center-error glass"
          role="status"
          onClick={() => setError('')}
        >
          {error}
        </button>
      )}
    </>
  );
}
