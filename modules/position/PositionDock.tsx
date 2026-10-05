import { LocateFixed } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import type { DirectionMode } from './types';
import { DirectionControl } from './DirectionControl';
import './positionDock.css';
export function PositionDock({
  following,
  direction = 'free',
  locating,
  tracking = following && !locating,
  error,
  blocked,
  onLocate,
  onLocateAndFollow,
  onDirection,
  directionStatus,
  markControl,
  children,
}: {
  following: boolean;
  tracking?: boolean;
  error?: string;
  direction?: DirectionMode;
  directionStatus?: string;
  locating: boolean;
  blocked: boolean;
  onLocate: () => void;
  onLocateAndFollow?: () => void;
  onDirection?: (mode: DirectionMode) => void;
  markControl?: ReactNode;
  children?: ReactNode;
}) {
  const lastClick = useRef(0);
  const lastDoubleClick = useRef(0);
  const doubleLocate = () => {
    if (!onLocateAndFollow) return;
    if (Date.now() - lastDoubleClick.current < 350) return;
    lastDoubleClick.current = Date.now();
    onLocateAndFollow();
  };
  return (
    <nav className="home-position-dock" aria-label="地图定位工具">
      <div className="position-extended-controls">
      {children}
      {markControl}
      {onDirection && <DirectionControl mode={direction} status={directionStatus} onChange={onDirection}/>}
      </div>
      <button
        className="position-dock-button position-locate-button glass"
        aria-label={following ? '关闭位置跟随' : '开启位置跟随'}
        aria-pressed={tracking && !blocked}
        title={blocked ? '编辑中暂停跟随' : error || (locating ? '等待有效定位，尚未跟随' : undefined)}
        onClick={event => {
          const now = Date.now();
          if (
            onLocateAndFollow &&
            (event.detail >= 2 || now - lastClick.current < 350)
          ) {
            lastClick.current = 0;
            doubleLocate();
          }
          else {
            lastClick.current = now;
            onLocate();
          }
        }}
        onDoubleClick={event => {
          event.preventDefault();
          doubleLocate();
        }}
      >
        <LocateFixed size={17} />
        <small>{error ? '重试定位' : locating ? '定位中' : tracking ? '跟随中' : '跟随'}</small>
      </button>
    </nav>
  );
}
