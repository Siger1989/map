'use client';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
import { applyInputColor, hexToHsv, hsvToHex, normalizeHexColor } from './colorSelection';
import '../guidance/navigationStart.css';
import './appColorPicker.css';

const COLORS = [
  ['#e41a1c', '红色'], ['#377eb8', '蓝色'], ['#4daf4a', '绿色'],
  ['#984ea3', '紫色'], ['#ff7f00', '橙色'], ['#f781bf', '粉色'],
  ['#59dcff', '青色'], ['#d0f76b', '黄绿'], ['#ffd54f', '黄色'],
  ['#ffb477', '浅橙'], ['#a379de', '浅紫'], ['#795548', '棕色'],
  ['#ffffff', '白色'], ['#cfd8dc', '浅灰'], ['#90a4ae', '灰色'],
  ['#546e7a', '深灰'], ['#18201f', '深绿'], ['#000000', '黑色'],
] as const;

function ColorDialog({ input, onClose }: { input: HTMLInputElement; onClose: () => void }) {
  const root = useRouteDialogFocus(onClose);
  const [custom, setCustom] = useState(false);
  const [hsv, setHsv] = useState(() => hexToHsv(input.value));
  const latest = useRef(hsv);
  const preview = hsvToHex(hsv.h, hsv.s, hsv.v);
  const choose = (value: string) => { applyInputColor(input, value); onClose(); };
  const update = (next: typeof hsv) => { latest.current = next; setHsv(next); };
  const planePoint = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const next = { h: latest.current.h,
      s: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      v: 1 - Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
    update(next); return next;
  };
  return createPortal(
    <div className="route-dialog-backdrop app-color-picker-backdrop" data-native-map-ui data-native-modal="true"
      onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={root} className="app-color-picker" role="dialog" aria-modal="true"
        aria-label="选择颜色" onPointerDown={event => event.stopPropagation()}>
        <header>
          <strong>{custom ? '自定义颜色' : '选择颜色'}</strong>
          <button type="button" aria-label={custom ? '返回常用颜色' : '关闭颜色选择'}
            onClick={() => custom ? setCustom(false) : onClose()}>{custom ? '返回' : '×'}</button>
        </header>
        {custom ? <>
          <div className="app-color-plane" role="slider" aria-label="颜色明暗和饱和度" tabIndex={0}
            aria-valuetext={preview} style={{ backgroundColor: hsvToHex(hsv.h, 1, 1) }}
            onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); planePoint(event); }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) planePoint(event); }}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              const next = planePoint(event); event.currentTarget.releasePointerCapture(event.pointerId);
              choose(hsvToHex(next.h, next.s, next.v));
            } }}
            onPointerCancel={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(preview); }
              else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
                event.preventDefault(); update({ ...hsv,
                  s: Math.max(0, Math.min(1, hsv.s + (event.key === 'ArrowLeft' ? -0.01 : event.key === 'ArrowRight' ? 0.01 : 0))),
                  v: Math.max(0, Math.min(1, hsv.v + (event.key === 'ArrowDown' ? -0.01 : event.key === 'ArrowUp' ? 0.01 : 0))) });
              }
            }}><i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: preview }} /></div>
          <input className="app-color-hue" type="range" aria-label="色相" min={0} max={359} step={1}
            value={hsv.h} onChange={event => update({ ...hsv, h: Number(event.target.value) })} />
          <label className="app-color-hex"><i style={{ background: preview }} /><span>HEX</span>
            <input aria-label="自定义颜色值" type="text" inputMode="text" autoComplete="off" spellCheck={false}
              placeholder={preview.toUpperCase()} maxLength={7}
              onChange={event => { const value = normalizeHexColor(event.target.value); if (value) choose(value); }} />
          </label>
        </> : <>
          <div className="app-color-grid" role="group" aria-label="常用颜色">
            {COLORS.map(([color, name]) => <button key={color} type="button" data-color={color}
              aria-label={name} aria-pressed={input.value.toLowerCase() === color} title={name}
              onClick={() => choose(color)}><i style={{ background: color }} /></button>)}
          </div>
          <button type="button" className="app-color-custom" onClick={() => setCustom(true)}>
            <i style={{ background: input.value }} />自定义颜色<span>{input.value.toUpperCase()}</span>
          </button>
        </>}
      </section>
    </div>, document.body,
  );
}

/** One chooser for existing route, drawing, marker and theme color inputs. */
export function AppColorPicker() {
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  useEffect(() => {
    const open = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.type !== 'color' || target.disabled || target.readOnly) return;
      event.preventDefault(); target.focus({ preventScroll: true }); setInput(target);
    };
    document.addEventListener('click', open, true);
    return () => document.removeEventListener('click', open, true);
  }, []);
  return input ? <ColorDialog input={input} onClose={() => setInput(null)} /> : null;
}
