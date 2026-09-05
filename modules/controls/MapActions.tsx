import { Compass, Minus, Plus } from 'lucide-react';

export function MapActions({
  terrain,
  bearing,
  onZoom,
  onNorth,
  onDimension,
}: {
  terrain: boolean;
  bearing: number;
  onZoom: (amount: number) => void;
  onNorth: () => void;
  onDimension: () => void;
}) {
  return (
    <nav className="map-actions glass" aria-label="地图快捷操作">
      <button
        className="icon-button"
        aria-label="放大地图"
        onClick={() => onZoom(1)}
      >
        <Plus size={21} />
      </button>
      <button
        className="icon-button"
        aria-label="缩小地图"
        onClick={() => onZoom(-1)}
      >
        <Minus size={21} />
      </button>
      <button className="icon-button" aria-label="地图朝北" onClick={onNorth}>
        <Compass size={22} style={{ transform: `rotate(${-bearing}deg)` }} />
      </button>
      <button
        className="dimension-button"
        aria-label={terrain ? '切换二维地图' : '切换三维地形'}
        aria-pressed={terrain}
        onClick={onDimension}
      >
        {terrain ? '3D' : '2D'}
      </button>
    </nav>
  );
}
