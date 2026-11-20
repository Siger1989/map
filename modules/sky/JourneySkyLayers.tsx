import { useEffect, useId, useRef, useState } from 'react';
import { Layers, Moon, Orbit, Sparkles, Sun } from 'lucide-react';
import { constellationOptions } from './constellations';
import { defaultJourneySkyLayers, journeySkyLayerKey, parseJourneySkyLayers, type JourneySkyLayerSettings } from './journeySkyLayerSettings';
import './journeySkyLayers.css';

export type { JourneySkyLayerSettings } from './journeySkyLayerSettings';

export function useJourneySkyLayers() {
  const [layers, setLayers] = useState<JourneySkyLayerSettings>(() => {
    try { return parseJourneySkyLayers(window.localStorage.getItem(journeySkyLayerKey)); }
    catch { return { ...defaultJourneySkyLayers }; }
  });
  useEffect(() => {
    try { window.localStorage.setItem(journeySkyLayerKey, JSON.stringify(layers)); }
    catch { /* Selections still apply to the current journey when local storage is unavailable. */ }
  }, [layers]);
  return [layers, setLayers] as const;
}

const toggles = [
  { key: 'sun', name: '太阳', icon: Sun }, { key: 'moon', name: '月亮', icon: Moon },
  { key: 'constellations', name: '星座', icon: Sparkles }, { key: 'milkyWay', name: '银河', icon: Orbit },
] as const;

export function JourneySkyLayers({ layers, onChange, disabled = false }: {
  layers: JourneySkyLayerSettings;
  onChange(layers: JourneySkyLayerSettings): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const visible = open && !disabled;
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!visible) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !holder.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [visible]);
  return <div className="journey-sky-picker" ref={holder}>
    <button ref={trigger} className="journey-sky-trigger" type="button" disabled={disabled}
      aria-expanded={visible} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <Layers size={15} aria-hidden="true"/>天空图层
    </button>
    {visible && <section className="journey-sky-options" id={id} aria-label="行程天空图层">
      {toggles.map(({ key, name, icon: Icon }) => <label className="journey-sky-toggle" key={key}>
        <Icon size={16} aria-hidden="true"/><span>{name}</span>
        <input type="checkbox" checked={layers[key]} onChange={event => onChange({ ...layers, [key]: event.currentTarget.checked })}/>
      </label>)}
      {layers.constellations && <label className="journey-sky-constellation">
        <span>显示星座</span>
        <select value={layers.constellationId} onChange={event => onChange({ ...layers, constellationId: event.currentTarget.value })}>
          <option value="all">全部星座</option>
          {constellationOptions.map(({id, name}) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>}
    </section>}
  </div>;
}
