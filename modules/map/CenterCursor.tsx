import { useEffect, useRef, useState } from 'react';
import { MapPinPlus } from 'lucide-react';
import type { Coordinate } from '../navigation/types';
import type { MapHandle } from './TerrainMap';
import './centerCursor.css';

/** The public map projection, not GPS, supplies the location under the reticle. */
export function CenterReticle() {
  return <div className="map-center-cursor" aria-hidden="true"><i /><b /><span className="map-center-cursor-dot" /></div>;
}

export function CenterMarkButton({
  map,
  onAdd,
  target,
  disabled = false,
}: {
  map: () => MapHandle | null;
  onAdd: (point: Coordinate) => void;
  target?: Coordinate;
  disabled?: boolean;
}) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const flight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return (
    <>
      <button
        className="position-dock-button center-add glass"
        aria-label={target ? '在所选路线点添加标记' : '在地图中心准星处添加标记'}
        aria-busy={pending}
        disabled={disabled || pending}
        title={disabled ? '完成当前编辑后可添加标记' : undefined}
        onClick={async () => {
          if (disabled || flight.current) return;
          flight.current = true;
          setPending(true);
          setError('');
          const handle = map();
          try {
            // The renderer already has ground even when its WebView DEM snapshot
            // has not arrived. Ask that renderer rather than guessing a camera/GPS point.
            const coordinate = target ?? (handle?.centerCoordinateAsync
              ? await handle.centerCoordinateAsync() : handle?.centerCoordinate());
            if (!mounted.current || (!target && handle !== map())) return;
            if (!coordinate) {
              setError('准星下暂无可选地面，请移动地图后重试');
              return;
            }
            onAdd(coordinate);
          } catch {
            if (mounted.current) setError('地图地面尚未就绪，请稍后重试');
          } finally {
            flight.current = false;
            if (mounted.current) setPending(false);
          }
        }}
      >
        <MapPinPlus size={18} />
        <small>{pending ? '选点中' : '标记'}</small>
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
