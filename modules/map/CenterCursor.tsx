import { useState } from 'react';
import { MapPinPlus } from 'lucide-react';
import type { Coordinate } from '../navigation/types';
import type { MapHandle } from './TerrainMap';
import './centerCursor.css';

/** The public map projection, not GPS, supplies the location under the reticle. */
export function CenterReticle() {
  return <div className="map-center-cursor" aria-hidden="true"><i /><b /></div>;
}

export function CenterMarkButton({
  map,
  onAdd,
  target,
}: {
  map: () => MapHandle | null;
  onAdd: (point: Coordinate) => void;
  target?: Coordinate;
}) {
  const [error, setError] = useState('');
  return (
    <>
      <button
        className="position-dock-button center-add glass"
        aria-label={target ? '在所选路线点添加标记' : '在地图中心准星处添加标记'}
        onClick={() => {
          const coordinate = target ?? map()?.centerCoordinate();
          if (!coordinate) {
            setError('准星下暂无可选地面，请移动地图后重试');
            return;
          }
          setError('');
          onAdd(coordinate);
        }}
      >
        <MapPinPlus size={18} />
        <small>标记</small>
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
