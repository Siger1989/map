import { isLayoutInteraction } from '../uiLayout/events';
import { useEffect, useRef } from 'react';
import { Layers, X } from 'lucide-react';
import type { LayerSettings } from '../map/types';
import { LayerPanel } from './LayerPanel';
import { LayerPresets } from './LayerPresets';
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
}) {
  const root = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const change = useRef(onOpen);
  change.current = onOpen;
  const close = () => {
    onOpen(false);
    toggle.current?.focus({ preventScroll: true });
  };
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
          close();
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
          <div className="dock-heading">
            <h2 id="layer-window-title">图层</h2>
            <button
              ref={closeButton}
              className="icon-button"
              onClick={close}
              aria-label="关闭图层窗口"
            >
              <X size={18} />
            </button>
          </div>
          <div className="dock-content">
            <LayerPanel
              presets={<LayerPresets settings={settings} onChange={onChange} />}
              customSource={customSource}
              onOpenSources={onOpenSources}
              settings={settings}
              onChange={onChange}
              satelliteDate={satelliteDate}
              satelliteStatus={satelliteStatus}
            />

            <p className="map-status" role="status">
              {mapStatus}
            </p>
          </div>
        </section>
      )}
    </section>
  );
}
