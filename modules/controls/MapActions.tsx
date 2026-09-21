import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Compass,
  Minus,
  Plus,
  Smartphone,
  MoreHorizontal,
  Scan,
  Settings2,
  Rotate3D,
  Expand,
  X,
} from 'lucide-react';
import { PositionDock } from '../position/PositionDock';
import type { DirectionMode, PositionFix } from '../position/types';

/** Home chrome; camera, positioning and route state stay with their owners. */
export function MapActions(props: {
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
  onOverview?: () => void;
  fix?: PositionFix | null;
  showCoordinates?: boolean;
  displayControl?: ReactNode;
  viewControl?: ReactNode;
}) {
  const [panel, setPanel] = useState<'view' | 'more' | 'location' | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (props.compact) setPanel(null);
  }, [props.compact]);
  useEffect(() => {
    if (!panel) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setPanel(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanel(null);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [panel]);
  const act = (action: () => void) => {
    action();
    setPanel(null);
  };
  return (
    <>
      <PositionDock
        following={props.following}
        locating={props.locating}
        blocked={props.followBlocked}
        onLocate={props.onLocate}
        fix={props.fix}
        showCoordinates={props.showCoordinates}
      >
        <button
          className="position-dock-button glass"
          aria-label="放大地图"
          onClick={() => props.onZoom(1)}
        >
          <Plus size={23} />
        </button>
        <button
          className="position-dock-button glass"
          aria-label="缩小地图"
          onClick={() => props.onZoom(-1)}
        >
          <Minus size={23} />
        </button>
        {props.displayControl}
      </PositionDock>
      <nav
        ref={root}
        className="map-actions home-map-actions"
        aria-label="地图快捷操作"
      >
        <button
          className="dimension-button"
          disabled={props.sectionActive}
          aria-label={props.terrain ? '切换二维地图' : '切换三维地形'}
          aria-pressed={props.terrain}
          onClick={props.onDimension}
        >
          {props.terrain ? '3D' : '2D'}
        </button>
        <button
          className="icon-button direction-button"
          aria-label="地图视角"
          aria-expanded={panel === 'view'}
          onClick={() => setPanel(panel === 'view' ? null : 'view')}
        >
          <Rotate3D size={21} />
          <small>视角</small>
        </button>
        <button
          className="icon-button"
          aria-label="更多地图操作"
          aria-expanded={panel === 'more'}
          onClick={() => setPanel(panel === 'more' ? null : 'more')}
        >
          <MoreHorizontal size={23} />
        </button>
        {panel && (
          <section
            className={`home-map-popup home-${panel}-panel`}
            aria-label={
              panel === 'view'
                ? '视角设置'
                : panel === 'more'
                  ? '更多地图操作菜单'
                  : '定位设置'
            }
          >
            <header>
              <strong>
                {panel === 'view'
                  ? '视角'
                  : panel === 'more'
                    ? '更多'
                    : '定位设置'}
              </strong>
              <button
                onClick={() => setPanel(null)}
                aria-label="关闭地图操作窗口"
              >
                <X size={16} />
              </button>
            </header>
            {panel === 'view' && (
              <>
                {props.viewControl}
                <div className="home-view-directions">
                  <button
                    aria-pressed={props.direction === 'north'}
                    onClick={props.onNorth}
                  >
                    <Compass
                      size={17}
                      style={{ transform: `rotate(${-props.bearing}deg)` }}
                    />
                    正北朝上
                  </button>
                  <button
                    disabled={props.sectionActive}
                    aria-pressed={props.direction === 'device'}
                    onClick={props.onDevice}
                  >
                    <Smartphone size={17} />
                    跟随手机方向
                  </button>
                </div>
              </>
            )}
            {panel === 'more' && (
              <div className="home-menu-items">
                <button onClick={() => act(props.onBoxSelect)}>
                  <Scan size={18} />
                  框选对象
                </button>
                <button
                  disabled={!props.onOverview}
                  title={!props.onOverview ? '先选择一条路线' : undefined}
                  onClick={() => props.onOverview && act(props.onOverview)}
                >
                  <Expand size={18} />
                  区域总览
                </button>
                <button onClick={() => setPanel('location')}>
                  <Settings2 size={18} />
                  定位设置
                </button>
              </div>
            )}
            {panel === 'location' && (
              <div className="home-menu-items">
                <p>
                  {props.networkMode
                    ? '基站 / Wi-Fi 大致位置'
                    : '自动定位 · 优先 GPS'}
                </p>
                {props.fix && (
                  <p>定位精度 ±{Math.round(props.fix.accuracy)}m</p>
                )}
                {props.networkAvailable && (
                  <button
                    disabled={props.followBlocked}
                    onClick={() => act(props.onNetwork)}
                  >
                    {props.networkMode ? '切回自动定位' : '使用室内网络定位'}
                  </button>
                )}
                {props.watching && (
                  <button onClick={() => act(props.onStopLocation)}>
                    停止持续定位
                  </button>
                )}
              </div>
            )}
          </section>
        )}
      </nav>
    </>
  );
}
