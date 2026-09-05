import { useEffect, useRef, type ReactNode } from 'react';
import { Clock3, Layers, Route, MapPinPlus, X } from 'lucide-react';

export type ControlPanel =
  | 'weather'
  | 'time'
  | 'layers'
  | 'route'
  | 'track'
  | 'favorites'
  | 'annotations'
  | null;
const PANELS = [
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
}: {
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
            {active === 'time' ? timeline : children}
          </div>
        </section>
      )}
      <div className="map-toolbar">
        {summary}
        <nav className="dock-navigation glass" aria-label="地图功能">
          {PANELS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-panel-toggle={id}
              aria-label={id === 'time' ? `天气时间轴，${timeLabel}` : label}
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
              <span>{id === 'time' ? timeLabel : label}</span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}
