import { useState } from 'react';
import {
  Compass,
  LocateFixed,
  Minus,
  Plus,
  Smartphone,
  MoreHorizontal,
} from 'lucide-react';
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
  following,
  followBlocked,
  direction,
  onDevice,
  onStopLocation,
  sectionActive,
  networkAvailable,
  networkMode,
  onNetwork,
}: {
  terrain: boolean;
  bearing: number;
  onZoom: (amount: number) => void;
  onNorth: () => void;
  onDimension: () => void;
  onLocate: () => void;
  locating: boolean;
  watching: boolean;
  following: boolean;
  followBlocked: boolean;
  direction: DirectionMode;
  onDevice: () => void;
  onStopLocation: () => void;
  sectionActive: boolean;
  networkAvailable: boolean;
  networkMode: boolean;
  onNetwork: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <nav
      className={`map-actions glass${expanded ? ' is-expanded' : ''}`}
      aria-label="地图快捷操作"
    >
      <button
        className="icon-button location-button direction-button"
        aria-label={
          following
            ? locating
              ? '等待定位，点击暂停跟随'
              : '暂停位置跟随'
            : '跟随当前位置'
        }
        disabled={followBlocked}
        title={followBlocked ? '结束地图编辑后可跟随' : undefined}
        aria-pressed={following}
        onClick={onLocate}
      >
        <LocateFixed size={20} />
        <small>{following ? (locating ? '等待' : '跟随') : '浏览'}</small>
      </button>
      {watching && expanded && (
        <button
          className="location-stop"
          onClick={onStopLocation}
          aria-label="停止持续定位"
        >
          停定位
        </button>
      )}
      {expanded && (
        <>
          {networkAvailable && (
            <button
              className="icon-button direction-button"
              aria-label={
                networkMode ? '切回自动定位' : '室内网络定位（基站与 Wi-Fi）'
              }
              aria-pressed={networkMode}
              disabled={followBlocked}
              onClick={onNetwork}
            >
              <LocateFixed size={20} />
              <small>{networkMode ? '自动' : '室内'}</small>
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
            <Compass
              size={22}
              style={{ transform: `rotate(${-bearing}deg)` }}
            />
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
        </>
      )}
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
        className="icon-button"
        aria-label="更多地图操作"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <MoreHorizontal size={21} />
      </button>
    </nav>
  );
}
