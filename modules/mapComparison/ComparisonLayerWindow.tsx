import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import type { ComparisonChoice } from './choices';
import type { LayerSettings } from '../map/types';
import { LayerPanel } from '../controls/LayerPanel';
import { LayerPresets } from '../controls/LayerPresets';
import { isLayoutInteraction } from '../uiLayout/events';
import '../controls/layerWindow.css';
import './comparisonLayers.css';

export function ComparisonLayerWindow({
  pane,
  onPane,
  choice,
  side,
  onChange,
  onSource,
  onClose,
  status,
  satelliteDate,
  satelliteStatus,
}: {
  pane: 0 | 1;
  onPane: (pane: 0 | 1) => void;
  choice: ComparisonChoice;
  side: (pane: 0 | 1) => string;
  onChange: (patch: Partial<LayerSettings>) => void;
  onSource: () => void;
  onClose: () => void;
  status: string;
  satelliteDate?: string;
  satelliteStatus?: string;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  const dismiss = useRef(onClose);
  dismiss.current = onClose;
  useEffect(() => {
    closeButton.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (isLayoutInteraction(event)) return;
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !(
          event.target instanceof Element &&
          event.target.closest('[aria-label="对比图层"]')
        )
      )
        dismiss.current();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, []);
  return (
    <section
      className="map-layer-control comparison-layer-control"
      data-app-back="40"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <section
        ref={root}
        id="comparison-layer-window"
        className="layer-window control-popover glass comparison-layer-window"
        aria-label="对比图层设置"
      >
        <div className="dock-heading">
          <h2>图层</h2>
          <div className="comparison-layer-tabs" aria-label="选择设置画面">
            {([0, 1] as const).map((index) => (
              <button
                key={index}
                type="button"
                aria-pressed={pane === index}
                onClick={() => onPane(index)}
              >
                {side(index)}图
              </button>
            ))}
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            type="button"
            aria-label="关闭对比图层"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="dock-content" key={pane}>
          <LayerPanel
            settings={choice.settings}
            onChange={onChange}
            customSource={choice.source ? choice.name : undefined}
            onOpenSources={onSource}
            satelliteDate={satelliteDate}
            satelliteStatus={satelliteStatus}
            presets={
              <LayerPresets settings={choice.settings} onChange={onChange} />
            }
          />
          {status && (
            <p className="map-status" role="status">
              {status}
            </p>
          )}
        </div>
      </section>
    </section>
  );
}
