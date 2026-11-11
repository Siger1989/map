import { isLayoutInteraction } from '../uiLayout/events';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Layers } from 'lucide-react';
import type { LayerSettings } from '../map/types';
import { LayerPanel } from './LayerPanel';
import { MapPanelHeader } from '../ui/MapPanelHeader';
import './layerWindow.css';

/** A map-level entry and non-modal window, independent of the bottom tool dock. */
export function LayerWindow({
  open,
  onOpen,
  settings,
  onChange,
  customSource,
  onOpenSources,
  satelliteDate,
  satelliteStatus,
  mapStatus,
  detail,
  onDetailBack,
  onGeologyDetails,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  settings: LayerSettings;
  onChange: (patch: Partial<LayerSettings>) => void;
  customSource?: string;
  onOpenSources: () => void;
  satelliteDate?: string;
  satelliteStatus?: string;
  mapStatus: string;
  detail?: ReactNode;
  onDetailBack?: () => void;
  onGeologyDetails?: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const parentScroll = useRef(0);
  const parentFocus = useRef<HTMLElement | null>(null);
  const showingDetail = useRef(false);
  const change = useRef(onOpen);
  change.current = onOpen;
  const close = () => {
    onOpen(false);
    toggle.current?.focus({ preventScroll: true });
  };
  const openGeologyDetails = () => {
    parentScroll.current = content.current?.scrollTop ?? 0;
    const active = content.current?.ownerDocument.activeElement;
    parentFocus.current = active && content.current?.contains(active) ? active as HTMLElement : null;
    onGeologyDetails?.();
  };
  useLayoutEffect(() => {
    if (!open) {
      showingDetail.current = false;
      parentScroll.current = 0;
      parentFocus.current = null;
      return;
    }
    const nextDetail = Boolean(detail);
    if (nextDetail !== showingDetail.current && content.current) {
      content.current.scrollTop = nextDetail ? 0 : parentScroll.current;
      if (nextDetail) closeButton.current?.focus({ preventScroll: true });
      else if (parentFocus.current?.isConnected) parentFocus.current.focus({ preventScroll: true });
      else closeButton.current?.focus({ preventScroll: true });
    }
    showingDetail.current = nextDetail;
  }, [open, detail]);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (isLayoutInteraction(event)) return;
      if (event.target instanceof Node && !root.current?.contains(event.target))
        change.current(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  return (
    <section
      ref={root}
      className="map-layer-control"
      data-app-back={open ? 30 : undefined}
      aria-label="图层窗口入口"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          if (detail && onDetailBack) onDetailBack();
          else close();
        }
      }}
    >
      <button
        ref={toggle}
        className="map-layer-toggle glass"
        aria-label="图层"
        aria-expanded={open}
        aria-controls={open ? 'map-layer-window' : undefined}
        onClick={() => onOpen(!open)}
      >
        <Layers size={19} />
        <span>图层</span>
      </button>
      {open && (
        <section
          id="map-layer-window"
          className="layer-window control-popover glass"
          role="region"
          aria-labelledby="layer-window-title"
        >
          <MapPanelHeader
            title={detail ? '地质图例' : '图层'}
            titleId="layer-window-title"
            onClose={close}
            closeLabel="关闭图层窗口"
            closeButtonRef={(element) => { closeButton.current = element; }}
            back={detail ? { label: '返回图层设置', onClick: () => onDetailBack?.() } : undefined}
          />
          <div ref={content} className="dock-content" onScroll={(event) => {
            if (!detail) parentScroll.current = event.currentTarget.scrollTop;
          }}>
            <div className="layer-parent-page" hidden={Boolean(detail)} inert={Boolean(detail)} aria-hidden={detail ? true : undefined} style={{ display: detail ? 'none' : undefined, flex: '0 0 auto' }}>
            <LayerPanel
              customSource={customSource}
              onOpenSources={onOpenSources}
              settings={settings}
              onChange={onChange}
              satelliteDate={satelliteDate}
              satelliteStatus={satelliteStatus}
              onGeologyDetails={onGeologyDetails ? openGeologyDetails : undefined}
            />

            <p className="map-status" role="status">
              {mapStatus}
            </p>
            </div>
            {detail}
          </div>
        </section>
      )}
    </section>
  );
}
