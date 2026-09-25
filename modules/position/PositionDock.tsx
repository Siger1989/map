import { LocateFixed, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, useId, type ReactNode } from 'react';
import type { PositionFix, DirectionMode } from './types';
import { DirectionControl } from './DirectionControl';
import './positionDock.css';
export function PositionDock({
  following,
  direction = 'free',
  locating,
  blocked,
  onLocate,
  onLocateAndFollow,
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
  onLocateAndFollow?: () => void;
  onDirection?: (mode: DirectionMode) => void;
  fix?: PositionFix | null;
  showCoordinates?: boolean;
  markControl?: ReactNode;
  children?: ReactNode;
}) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsId = useId();
  const dock = useRef<HTMLElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!toolsOpen) return;
    const outside = (event: PointerEvent) => {
      if (!dock.current?.contains(event.target as Node)) setToolsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setToolsOpen(false);
        toolsButton.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [toolsOpen]);
  const clickTimer = useRef<number | null>(null);
  const lastClick = useRef(0);
  const lastDoubleClick = useRef(0);
  useEffect(() => () => {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
  }, []);
  const doubleLocate = () => {
    if (!onLocateAndFollow) return;
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = null;
    if (Date.now() - lastDoubleClick.current < 350) return;
    lastDoubleClick.current = Date.now();
    onLocateAndFollow();
  };
  return (
    <nav ref={dock} className="home-position-dock" aria-label="底部定位与路线显示" data-tools-open={toolsOpen}>
      <button ref={toolsButton} className="position-dock-button position-tools-toggle" aria-label={toolsOpen ? '收起地图工具' : '展开地图工具'} aria-expanded={toolsOpen} aria-controls={toolsId} onClick={() => setToolsOpen(open => !open)}>
        {toolsOpen ? <X size={20} /> : <SlidersHorizontal size={20} />}
        <small>工具</small>
      </button>
      <div id={toolsId} className="position-extended-controls">
      {children}
      {onDirection && <DirectionControl mode={direction} status={directionStatus} onChange={onDirection}/>}
      {markControl}
      </div>
      <button
        className="position-dock-button position-locate-button glass"
        aria-label={following ? '关闭位置跟随' : '开启位置跟随'}
        aria-pressed={following}
        title={blocked ? '编辑中暂停跟随' : undefined}
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
            if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
            lastClick.current = now;
            clickTimer.current = window.setTimeout(() => {
              clickTimer.current = null;
              lastClick.current = 0;
              onLocate();
            }, onLocateAndFollow ? 280 : 0);
          }
        }}
        onDoubleClick={event => {
          event.preventDefault();
          doubleLocate();
        }}
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
            : '尚未定位'}
        </output>
      )}
    </nav>
  );
}
