import { useEffect, useRef, type ReactNode } from 'react';
import {
  Clock3,
  Layers,
  Route,
  MapPinPlus,
  X,
  Menu,
  Footprints,
  Orbit,
} from 'lucide-react';

export type ControlPanel =
  | 'weather'
  | 'time'
  | 'layers'
  | 'route'
  | 'track'
  | 'favorites'
  | 'annotations'
  | 'tools'
  | 'outdoor'
  | null;
const PANELS = [
  { id: 'outdoor', label: '行程', icon: Footprints },
  { id: 'tools', label: '工具', icon: Menu },
  { id: 'time', label: '时间', icon: Clock3 },
  { id: 'layers', label: '图层', icon: Layers },
  { id: 'route', label: '路线', icon: Route },
  { id: 'annotations', label: '标记', icon: MapPinPlus },
] as const;

/** Small map tools with one dismissible popover; never a persistent bottom sheet. */
export function ControlDock({
  active,
  onActive,
  summary,
  timeline,
  timeLabel = '时间',
  children,
  cameraOpen,
  onCamera,
}: {
  cameraOpen: boolean;
  onCamera: () => void;
  active: ControlPanel;
  onActive: (panel: ControlPanel) => void;
  summary: ReactNode;
  timeline: ReactNode;
  timeLabel?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const changePanel = useRef(onActive);
  changePanel.current = onActive;
  const close = () => {
    onActive(null);
    root.current
      ?.querySelector<HTMLButtonElement>(
        `[data-panel-toggle="${active === 'track' || active === 'favorites' ? 'route' : active}"]`,
      )
      ?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!active) return;
    closeButton.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        changePanel.current(null);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [active]);
  return (
    <section
      ref={root}
      className={`control-dock ${active ? 'is-expanded' : ''}`}
      aria-label="地图工具"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && active) {
          event.preventDefault();
          close();
        }
      }}
    >
      {active && (
        <section
          className="control-popover glass"
          role="region"
          aria-labelledby="dock-title"
          id="map-control-panel"
        >
          <div className="dock-heading">
            <h2 id="dock-title">
              {active === 'annotations'
                ? '标记与模型'
                : active === 'weather'
                  ? '地点天气'
                  : active === 'track'
                    ? '手绘轨迹'
                    : active === 'favorites'
                      ? '路线收藏夹'
                      : active === 'route'
                        ? '路线规划'
                        : PANELS.find((p) => p.id === active)?.label}
            </h2>
            <button
              ref={closeButton}
              className="icon-button"
              onClick={close}
              aria-label="关闭面板"
            >
              <X size={18} />
            </button>
          </div>
          <div className="dock-content" key={active}>
            {active === 'tools' ? (
              <div className="tool-grid">
                {PANELS.filter((p) => !['tools', 'outdoor'].includes(p.id)).map(
                  ({ id, label, icon: Icon }) => (
                    <button key={id} onClick={() => onActive(id)}>
                      <Icon size={18} />
                      {id === 'time' ? timeLabel : label}
                    </button>
                  ),
                )}
                <button aria-pressed={cameraOpen} onClick={onCamera}>
                  <Orbit size={18} />
                  视角盘
                </button>
                <button onClick={() => onActive('outdoor')}>
                  <Footprints size={18} />
                  行程与数据
                </button>
              </div>
            ) : active === 'time' ? (
              timeline
            ) : (
              children
            )}
          </div>
        </section>
      )}
      <div className="map-toolbar">
        {summary}
        <nav className="dock-navigation glass" aria-label="地图功能">
          {[PANELS[0], PANELS.find((p) => p.id === 'route')!, PANELS[1]].map(
            ({ id, label, icon: Icon }) => (
              <button
                key={id}
                data-panel-toggle={id}
                aria-label={label}
                aria-expanded={
                  active === id || (id === 'route' && active === 'track')
                }
                aria-controls={
                  active === id || (id === 'route' && active === 'track')
                    ? 'map-control-panel'
                    : undefined
                }
                onClick={() =>
                  onActive(
                    active === id || (id === 'route' && active === 'track')
                      ? null
                      : id,
                  )
                }
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ),
          )}
        </nav>
      </div>
    </section>
  );
}
