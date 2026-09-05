import { useEffect, useState } from 'react';
import type { SectionSettings, SectionStatus } from './types';
export function SectionPanel({
  settings,
  status,
  onAltitude,
  onColor,
  onClose,
  onRetry,
}: {
  settings: SectionSettings;
  status: SectionStatus;
  onAltitude: (height: number) => void;
  onColor: (color: string) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [text, setText] = useState(String(settings.altitude));
  const [dragging, setDragging] = useState(false);
  const [range, setRange] = useState(() => ({
    min: Math.min(status.min, settings.altitude),
    max: Math.max(status.max, settings.altitude),
  }));
  useEffect(() => setText(String(settings.altitude)), [settings.altitude]);
  useEffect(() => {
    // DEM reloads temporarily report default/partial bounds. They must not
    // change the pointer-to-altitude mapping, or the native range thumb jumps.
    if (dragging) return;
    setRange((previous) => {
      const complete = status.phase === 'ready' && status.valid > 0;
      const min = Math.min(
        complete ? status.min : previous.min,
        settings.altitude,
      );
      const max = Math.max(
        complete ? status.max : previous.max,
        settings.altitude,
      );
      return min === previous.min && max === previous.max
        ? previous
        : { min, max };
    });
  }, [
    dragging,
    status.phase,
    status.min,
    status.max,
    status.valid,
    settings.altitude,
  ]);
  const change = (height: number) => {
    if (Number.isFinite(height))
      onAltitude(Math.max(-32768, Math.min(32767, height)));
  };
  const loading = status.phase === 'loading' || status.phase === 'idle';
  return (
    <>
      <aside className="section-slider glass" aria-label="海拔剖面控制">
        <strong>3D 海拔剖面</strong>
        <label htmlFor="section-height-number">切面海拔（米）</label>
        <input
          id="section-height-number"
          type="number"
          min={-32768}
          max={32767}
          step={0.1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          onBlur={() => {
            if (text.trim() && Number.isFinite(Number(text)))
              change(Number(text));
            else setText(String(settings.altitude));
          }}
        />
        <label className="section-color-control">
          剖面颜色
          <input
            type="color"
            aria-label="剖面颜色"
            value={settings.color}
            onChange={(event) => onColor(event.target.value)}
          />
        </label>
        <span>{Math.ceil(range.max)} m</span>
        <input
          className="section-height-range"
          type="range"
          aria-label="剖切海拔"
          aria-orientation="vertical"
          aria-valuetext={`${settings.altitude} 米`}
          min={range.min}
          max={range.max}
          step={0.1}
          value={settings.altitude}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onLostPointerCapture={() => setDragging(false)}
          onBlur={() => setDragging(false)}
          onChange={(event) => change(Number(event.target.value))}
        />
        <span>{Math.floor(range.min)} m</span>
        <div className="section-fine">
          <button
            aria-label="降低一米"
            onClick={() => change(settings.altitude - 1)}
          >
            −1 m
          </button>
          <button
            aria-label="升高一米"
            onClick={() => change(settings.altitude + 1)}
          >
            ＋1 m
          </button>
        </div>
        <button onClick={onClose}>退出剖面</button>
      </aside>
      <div
        className="section-caption glass"
        data-phase={status.phase}
        role="status"
      >
        <strong>
          剖面 ·{' '}
          {settings.altitude.toLocaleString('zh-CN', {
            maximumFractionDigits: 1,
          })}{' '}
          m
        </strong>
        {loading && <span>更新中…</span>}
        {(status.phase === 'error' || status.phase === 'partial') && (
          <>
            <span>{status.phase === 'error' ? '加载失败' : '部分缺测'}</span>
            <button onClick={onRetry}>重试</button>
          </>
        )}
      </div>
    </>
  );
}
