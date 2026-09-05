import { Compass, LocateFixed, Minus, Plus, Smartphone } from 'lucide-react';
import type { DirectionMode } from '../position/types';

export function MapActions({
  terrain,
  bearing,
  onZoom,
  onNorth,
  onDimension,
  onLocate,
  locating,
  watching,
  direction,
  onDevice,
  onStopLocation,
  sectionActive,
  onSection,
}: {
  terrain: boolean;
  bearing: number;
  onZoom: (amount: number) => void;
  onNorth: () => void;
  onDimension: () => void;
  onLocate: () => void;
  locating: boolean;
  watching: boolean;
  direction: DirectionMode;
  onDevice: () => void;
  onStopLocation: () => void;
  sectionActive: boolean;
  onSection: () => void;
}) {
  return (
    <nav className="map-actions glass" aria-label="地图快捷操作">
      <button
        className="icon-button location-button"
        aria-label={locating ? '正在定位' : '定位到当前位置'}
        aria-pressed={watching}
        disabled={locating}
        onClick={onLocate}
      >
        <LocateFixed size={20} />
      </button>
      {watching && (
        <button
          className="location-stop"
          onClick={onStopLocation}
          aria-label="停止持续定位"
        >
          停定位
        </button>
      )}
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
      <button
        className="icon-button direction-button"
        aria-label="正北朝上"
        aria-pressed={direction === 'north'}
        onClick={onNorth}
      >
        <Compass size={22} style={{ transform: `rotate(${-bearing}deg)` }} />
        <small>北</small>
      </button>
      <button
        className="icon-button direction-button"
        aria-label="跟随手机方向"
        disabled={sectionActive}
        aria-pressed={direction === 'device'}
        onClick={onDevice}
      >
        <Smartphone size={19} />
        <small>随</small>
      </button>
      <button
        className="dimension-button"
        disabled={sectionActive}
        aria-label={terrain ? '切换二维地图' : '切换三维地形'}
        aria-pressed={terrain}
        onClick={onDimension}
      >
        {terrain ? '3D' : '2D'}
      </button>
      <button
        className="section-button"
        aria-label="海拔剖面"
        aria-pressed={sectionActive}
        onClick={onSection}
      >
        剖面
      </button>
    </nav>
  );
}
