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
  fix,
  showCoordinates,
  children,
}: {
  following: boolean;
  direction?: 'free' | 'north' | 'device';
  locating: boolean;
  blocked: boolean;
  onLocate: () => void;
  fix?: PositionFix | null;
  showCoordinates?: boolean;
  children?: ReactNode;
}) {
  return (
    <nav className="home-position-dock" aria-label="底部定位与路线显示">
      {children}
      <button
        className="position-dock-button glass"
        aria-label={
          blocked ? '获取当前位置（编辑中暂停地图跟随）' : following
            ? locating
              ? '等待定位，点击切换跟随模式'
              : direction === 'device' ? '指南针跟随，点击自由浏览' : '正北跟随，点击指南针模式'
            : '定位并正北跟随'
        }
        aria-pressed={following}
        title={blocked ? '编辑中可获取定位，结束编辑后可跟随' : undefined}
        onClick={onLocate}
      >
        {following && direction === 'device' ? <Compass size={17} /> : <LocateFixed size={17} />}
        <small>{following && direction === 'device' ? '指南针' : locating ? '定位中' : following ? '正北' : '定位'}</small>
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
