import type { ReactNode } from 'react';
import { ArrowLeft, Check, X } from 'lucide-react';
import './mapPanelHeader.css';

export function MapPanelHeader({
  title,
  titleId,
  onClose,
  closeLabel = '关闭面板',
  closeButtonRef,
  back,
  hide,
  save,
}: {
  title: ReactNode;
  titleId: string;
  onClose: () => void;
  closeLabel?: string;
  closeButtonRef?: (element: HTMLButtonElement | null) => void;
  back?: { label: string; onClick: () => void; disabled?: boolean };
  hide?: { label: string; onClick: () => void };
  save?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  // A return that performs the same action as close is a root-level dismiss,
  // not a second navigation level.
  const parent = back && back.onClick !== onClose ? back : undefined;
  return (
    <div className="dock-heading map-panel-header" data-ui-level={parent ? 'secondary' : 'primary'}>
      {hide && <button type="button" className="dock-hide" onClick={hide.onClick} aria-label={hide.label}>{hide.label}</button>}
      {parent && <button type="button" className="dock-back" aria-label={parent.label} title={parent.label} disabled={parent.disabled} onClick={parent.onClick}>
        <ArrowLeft size={16} aria-hidden="true" /><span>返回</span>
      </button>}
      <h2 id={titleId}>{parent && <span className="map-panel-header__parent">{parent.label.replace(/^返回/, '')} /</span>}{title}</h2>
      {save && <button className="icon-button map-panel-header__save" type="button" aria-label={save.label} title={save.label} disabled={save.disabled} onClick={save.onClick}><Check size={18} /></button>}
      {!parent && hide && <span className="map-panel-header__spacer" aria-hidden="true" />}
      <button ref={closeButtonRef} className="icon-button ui-panel-close" type="button" onClick={onClose} aria-label={closeLabel} title={closeLabel}><X size={18} /></button>
    </div>
  );
}
