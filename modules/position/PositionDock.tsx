import { LocateFixed } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PositionFix } from './types';
import './positionDock.css';
export function PositionDock({
  following,
  locating,
  blocked,
  onLocate,
  fix,
  showCoordinates,
  children,
}: {
  following: boolean;
  locating: boolean;
  blocked: boolean;
  onLocate: () => void;
  fix?: PositionFix | null;
  showCoordinates?: boolean;
  children?: ReactNode;
}) {
  return (
    <nav className="position-dock" aria-label="底部定位与路线显示">
      <button
        className="position-dock-button glass"
        aria-label={
          following
            ? locating
              ? '等待定位，点击暂停跟随'
              : '暂停位置跟随'
            : '跟随当前位置'
        }
        aria-pressed={following}
        disabled={blocked}
        title={blocked ? '结束地图编辑后可跟随' : undefined}
        onClick={onLocate}
      >
        <LocateFixed size={17} />
        <small>{following ? (locating ? '等待' : '跟随') : '定位'}</small>
      </button>
      {children}
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
