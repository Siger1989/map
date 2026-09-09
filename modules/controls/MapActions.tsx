import { useState } from 'react';
import {
  Compass,
  LocateFixed,
  Minus,
  Plus,
  Smartphone,
  MoreHorizontal,
  Scan,
  Settings2,
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
  onBoxSelect,
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
  onBoxSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [locationSettings, setLocationSettings] = useState(false);
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
      {locationSettings && (
        <section className="map-location-settings" aria-label="定位设置">
          <header>
            <strong>定位设置</strong>
            <button
              onClick={() => setLocationSettings(false)}
              aria-label="关闭定位设置"
            >
              ×
            </button>
          </header>
          <p>{networkMode ? '基站 / Wi-Fi 大致位置' : '自动定位 · 优先 GPS'}</p>
          {networkAvailable && (
            <button
              disabled={followBlocked}
              onClick={() => {
                onNetwork();
                setLocationSettings(false);
              }}
            >
              {networkMode ? '切回自动定位' : '使用室内网络定位'}
            </button>
          )}
          {watching && (
            <button
              onClick={() => {
                onStopLocation();
                setLocationSettings(false);
              }}
            >
              停止持续定位
            </button>
          )}
        </section>
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
      {expanded && (
        <>
          <button
            className="icon-button direction-button"
            aria-label="定位设置"
            aria-expanded={locationSettings}
            onClick={() => setLocationSettings(!locationSettings)}
          >
            <Settings2 size={20} />
            <small>设置</small>
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
        onClick={() => {
          setExpanded((v) => !v);
          setLocationSettings(false);
        }}
      >
        <MoreHorizontal size={21} />
      </button>
      <button
        className="icon-button direction-button"
        aria-label="框选标记与路线"
        onClick={onBoxSelect}
      >
        <Scan size={21} />
        <small>框选</small>
      </button>
    </nav>
  );
}
