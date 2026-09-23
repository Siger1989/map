import { LocateFixed } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PositionFix, DirectionMode } from './types';
import { DirectionControl } from './DirectionControl';
import './positionDock.css';
export function PositionDock({
  following,
  direction = 'free',
  locating,
  blocked,
  onLocate,
  onDirection,
  directionStatus,
  fix,
  showCoordinates,
  markControl,
  children,
}: {
  following: boolean;
  direction?: DirectionMode;
  directionStatus?: string;
  locating: boolean;
  blocked: boolean;
  onLocate: () => void;
  onDirection?: (mode: DirectionMode) => void;
  fix?: PositionFix | null;
  showCoordinates?: boolean;
  markControl?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <nav className="home-position-dock" aria-label="底部定位与路线显示">
      {children}
      {onDirection && <DirectionControl mode={direction} status={directionStatus} onChange={onDirection}/>}
      {markControl}
      <button
        className="position-dock-button position-locate-button glass"
        aria-label={following ? '关闭位置跟随' : '开启位置跟随'}
        aria-pressed={following}
        title={blocked ? '编辑中暂停跟随' : undefined}
        onClick={onLocate}
      >
        <LocateFixed size={17} />
        <small>{locating ? '定位中' : following ? '跟随中' : '跟随'}</small>
      </button>
      {showCoordinates && (
        <output
          className="position-dock-coordinates glass"
          aria-label="当前位置坐标"
        >
          {fix
            ? `${Math.abs(fix.coordinates[1]).toFixed(5)}°${fix.coordinates[1] < 0 ? 'S' : 'N'} ${Math.abs(fix.coordinates[0]).toFixed(5)}°${fix.coordinates[0] < 0 ? 'W' : 'E'} · ±${Math.round(fix.accuracy)}m`
            : '未定位 · 点击定位获取坐标'}
        </output>
      )}
    </nav>
  );
}
