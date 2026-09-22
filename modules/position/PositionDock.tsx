import { LocateFixed, Compass } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PositionFix } from './types';
import './positionDock.css';
export function PositionDock({
  following,
  direction = 'free',
  locating,
  blocked,
  onLocate,
  onDirection,
  fix,
  showCoordinates,
  children,
}: {
  following: boolean;
  direction?: 'free' | 'north' | 'device';
  locating: boolean;
  blocked: boolean;
  onLocate: () => void;
  onDirection?: () => void;
  fix?: PositionFix | null;
  showCoordinates?: boolean;
  children?: ReactNode;
}) {
  return (
    <nav className="home-position-dock" aria-label="底部定位与路线显示">
      {children}
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
      {onDirection && <button className="position-dock-button position-direction-button glass"
        aria-label={direction === 'device' ? '关闭方向感应' : '开启方向感应'}
        aria-pressed={direction === 'device'} onClick={onDirection}>
        <Compass size={17} /><small>{direction === 'device' ? '方向开' : '方向'}</small>
      </button>}
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
