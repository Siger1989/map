import { useEffect, useRef, type ReactNode } from 'react';
import {
  Clock3,
  Route,
  MapPinPlus,
  X,
  Menu,
  Footprints,
  Map as MapIcon,
  Bookmark,
  PencilLine,
  ScanLine,
  ChevronLeft,
  Ruler,
} from 'lucide-react';

export type ControlPanel =
  | 'about'
  | 'weather'
  | 'time'
  | 'layers'
  | 'route'
  | 'track'
  | 'favorites'
  | 'annotations'
  | 'tools'
  | 'outdoor'
  | 'sources'
  | null;
const PANELS = [
  { id: 'outdoor', label: '行程', icon: Footprints },
  { id: 'tools', label: '工具', icon: Menu },
  { id: 'time', label: '时间', icon: Clock3 },
  { id: 'sources', label: '地图图源', icon: MapIcon },
  { id: 'route', label: '路线', icon: Route },
  { id: 'annotations', label: '标记', icon: MapPinPlus },
  { id: 'favorites', label: '收藏', icon: Bookmark },
  { id: 'track', label: '画线', icon: PencilLine },
] as const;

/** Small map tools with one dismissible popover; never a persistent bottom sheet. */
export function ControlDock({
  active,
  onActive,
  summary,
  timeline,
  timeLabel = '时间',
  onSection,
  sectionActive = false,
  sectionReady = true,
  back,
  title,
  children,
  onScanRoute,
  onMeasure,
  keepOpenOnMapInteraction = false,
  mapPicking = false,
}: {
  active: ControlPanel;
  onActive: (panel: ControlPanel) => void;
  summary: ReactNode;
  timeline: ReactNode;
  timeLabel?: string;
  onSection?: () => void;
  sectionActive?: boolean;
  sectionReady?: boolean;
  back?: { label: string; onClick: () => void; disabled?: boolean };
  title?: string;
  children: ReactNode;
  onScanRoute?: () => void;
  onMeasure?: () => void;
  keepOpenOnMapInteraction?: boolean;
  mapPicking?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const changePanel = useRef(onActive);
  changePanel.current = onActive;
  const keepOpen = useRef(keepOpenOnMapInteraction);
  keepOpen.current = keepOpenOnMapInteraction;
  const close = () => {
    onActive(null);
    root.current
      ?.querySelector<HTMLButtonElement>(
        `[data-panel-toggle="${active === 'sources' ? 'tools' : active}"]`,
      )
      ?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!active) return;
    closeButton.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (
        !keepOpen.current &&
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      )
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
          // The parent owns cancelling a map-pick operation without closing its panel.
          if (mapPicking) return;
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
            {back && (
              <button
                className="dock-back"
                aria-label={back.label}
                title={back.label}
                disabled={back.disabled}
                onClick={back.onClick}
              >
                <ChevronLeft size={16} aria-hidden="true" />
                返回
              </button>
            )}
            <h2 id="dock-title">
              {title ??
                (active === 'about'
                  ? '关于山兔'
                  : active === 'annotations'
                    ? '标记与模型'
                    : active === 'weather'
                      ? '地点天气'
                      : active === 'track'
                        ? '画线与轨迹'
                        : active === 'favorites'
                          ? '全部收藏'
                          : active === 'route'
                            ? '路线规划'
                            : PANELS.find((p) => p.id === active)?.label)}
            </h2>
            {(active === 'route' || active === 'track') && (
              <button
                className="dock-section-link"
                onClick={() => onActive(active === 'route' ? 'track' : 'route')}
              >
                {active === 'route' ? '画线 / 轨迹' : '道路规划'}
              </button>
            )}
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
                {onMeasure && (
                  <button onClick={onMeasure}>
                    <Ruler size={18} />
                    测量
                  </button>
                )}
                {onScanRoute && (
                  <button onClick={onScanRoute}>
                    <ScanLine size={18} />
                    扫码载入路线
                  </button>
                )}
                <button onClick={() => onActive('track')}>
                  <PencilLine size={18} />
                  画线
                </button>
                {onSection && (
                  <button
                    onClick={onSection}
                    aria-label="勘探线剖面"
                    aria-pressed={sectionActive}
                    disabled={!sectionReady}
                  >
                    <ScanLine size={18} />
                    剖面
                  </button>
                )}
                {PANELS.filter(
                  (p) =>
                    !['tools', 'outdoor', 'favorites', 'track'].includes(p.id),
                ).map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => onActive(id)}>
                    <Icon size={18} />
                    {id === 'time' ? timeLabel : label}
                  </button>
                ))}
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
          {[
            PANELS[0],
            PANELS.find((p) => p.id === 'route')!,
            PANELS.find((p) => p.id === 'track')!,
            PANELS.find((p) => p.id === 'favorites')!,
            PANELS[1],
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              data-panel-toggle={id}
              aria-label={label}
              aria-expanded={active === id}
              aria-controls={active === id ? 'map-control-panel' : undefined}
              onClick={() => onActive(active === id ? null : id)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </section>
  );
}
