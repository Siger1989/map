import { useBackHandler } from './backNavigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PositionDock } from '../position/PositionDock';
import type { PositionFix } from '../position/types';
import {
  Compass,
  Minus,
  Plus,
  Smartphone,
  MoreHorizontal,
  Scan,
  Settings2,
} from 'lucide-react';
import type { DirectionMode } from '../position/types';
import { ViewSettings } from './ViewSettings';
import './mapActions.css';

export function MapActions({
  terrain,
  pitch,
  onAngle,
  onFree,
  onOverview,
  canOverview,
  onCoordinates,
  directionError,
  compact = false,
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
  fix,
  showCoordinates,
  displayControl,
}: {
  pitch: number;
  onAngle: (pitch: number, bearing: number) => void;
  onFree: () => void;
  onOverview: () => void;
  canOverview: boolean;
  onCoordinates: (value: boolean) => void;
  directionError?: string;
  terrain: boolean;
  compact?: boolean;
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
  fix?: PositionFix | null;
  showCoordinates?: boolean;
  displayControl?: ReactNode;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [locationSettings, setLocationSettings] = useState(false);
  const root = useRef<HTMLElement>(null);
  useBackHandler(viewOpen || expanded, root, () => {
    if (locationSettings) setLocationSettings(false);
    else {
      setViewOpen(false);
      setExpanded(false);
    }
  });
  useEffect(() => {
    if (compact) {
      setExpanded(false);
      setLocationSettings(false);
    }
  }, [compact]);
  return (
    <>
      <PositionDock
        following={following}
        locating={locating}
        blocked={followBlocked}
        onLocate={onLocate}
        fix={fix}
        showCoordinates={showCoordinates}
      >
        <div className="map-zoom-controls glass">
          <button aria-label="放大地图" onClick={() => onZoom(1)}>
            <Plus size={20} />
          </button>
          <button aria-label="缩小地图" onClick={() => onZoom(-1)}>
            <Minus size={20} />
          </button>
        </div>
        {displayControl}
      </PositionDock>
      <nav
        ref={root}
        className="map-actions"
        style={{ zIndex: viewOpen || expanded ? 65 : 35 }}
        aria-label="地图快捷操作"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && (expanded || viewOpen)) {
            e.preventDefault();
            e.stopPropagation();
            if (locationSettings) setLocationSettings(false);
            else {
              setExpanded(false);
              setViewOpen(false);
            }
          }
        }}
      >
        <button
          className="dimension-button glass"
          disabled={sectionActive}
          aria-label={terrain ? '切换二维地图' : '切换三维地形'}
          aria-pressed={terrain}
          onClick={onDimension}
        >
          {terrain ? '3D' : '2D'}
        </button>
        <button
          className="direction-button glass"
          aria-label="视角设置"
          aria-expanded={viewOpen}
          onClick={() => {
            setViewOpen(!viewOpen);
            setExpanded(false);
          }}
        >
          <Compass size={19} />
          <small>视角</small>
        </button>
        <button
          className="glass"
          aria-label="更多地图操作"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded(!expanded);
            setViewOpen(false);
            setLocationSettings(false);
          }}
        >
          <MoreHorizontal size={21} />
        </button>
        {viewOpen && (
          <ViewSettings
            pitch={pitch}
            bearing={bearing}
            direction={direction}
            terrain={terrain}
            disabled={sectionActive}
            error={directionError}
            onClose={() => setViewOpen(false)}
            onFree={onFree}
            onNorth={onNorth}
            onDevice={onDevice}
            onAngle={onAngle}
          />
        )}
        {expanded && (
          <section
            className="map-small-window glass"
            aria-label={locationSettings ? '定位设置' : '更多地图操作'}
          >
            <header>
              <strong>{locationSettings ? '定位设置' : '更多'}</strong>
              <button
                aria-label={locationSettings ? '返回更多' : '关闭更多'}
                onClick={() =>
                  locationSettings
                    ? setLocationSettings(false)
                    : setExpanded(false)
                }
              >
                返回
              </button>
            </header>
            {locationSettings ? (
              <>
                <label>
                  显示坐标
                  <input
                    type="checkbox"
                    checked={!!showCoordinates}
                    onChange={(e) => onCoordinates(e.target.checked)}
                  />
                </label>
                <small>
                  {networkMode
                    ? '基站 / Wi-Fi 大致位置'
                    : '自动定位 · 优先 GPS'}
                </small>
                {networkAvailable && (
                  <button disabled={followBlocked} onClick={onNetwork}>
                    {networkMode ? '切回自动定位' : '使用室内网络定位'}
                  </button>
                )}
                {watching && (
                  <button onClick={onStopLocation}>停止持续定位</button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    onBoxSelect();
                    setExpanded(false);
                  }}
                >
                  框选对象
                </button>
                <button
                  disabled={!canOverview}
                  onClick={() => {
                    onOverview();
                    setExpanded(false);
                  }}
                >
                  区域总览
                </button>
                <button onClick={() => setLocationSettings(true)}>
                  定位设置
                </button>
              </>
            )}
          </section>
        )}
      </nav>
    </>
  );
}
