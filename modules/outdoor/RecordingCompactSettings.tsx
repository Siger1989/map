import { useEffect, useState } from 'react';
import type { useRecording } from './useRecording';
import { SAMPLING_PRESETS, type SamplingPolicy } from './samplingPolicy';

function NumberField({ label, value, min, max, step = 1, disabled = false, onCommit }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onCommit: (value: number) => unknown }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input aria-label={label} type="number" inputMode="decimal" min={min} max={max} step={step} disabled={disabled} value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={e => { if (draft !== '' && e.currentTarget.checkValidity()) onCommit(Number(draft)); else setDraft(String(value)); }} /></label>;
}

/** Compact controls call the same persisted preferences as the full settings panels. */
export function RecordingCompactSettings({ recorder }: { recorder: ReturnType<typeof useRecording> }) {
  const { appearance, preferences, sampling } = recorder;
  const { style } = appearance;
  const policy = sampling.policy;
  const samplingNumber = (key: 'intervalSeconds' | 'distanceMetres', value: number) => sampling.update({ ...policy, mode: 'custom', [key]: value, stationarySeconds: key === 'intervalSeconds' ? Math.max(policy.stationarySeconds, value) : policy.stationarySeconds });
  return <div className="record-console-settings">
    <div className="record-console-grid">
      <label>着色<select aria-label="轨迹着色" value={style.colorMode ?? 'solid'} onChange={e => appearance.update({ ...style, colorMode: e.target.value as typeof style.colorMode })}><option value="solid">单色</option><option value="elevation">海拔</option><option value="speed">速度</option><option value="slope">坡度</option></select></label>
      <NumberField label="线宽px" value={style.width} min={.5} max={5} step={.5} onCommit={width => appearance.update({ ...style, width })} />
      <NumberField label="不透明%" value={Math.round((style.opacity ?? 1) * 100)} min={10} max={100} onCommit={opacity => appearance.update({ ...style, opacity: opacity / 100 })} />
      <label>颜色<input aria-label="轨迹颜色" type="color" value={style.color} onChange={e => appearance.update({ ...style, color: e.target.value })} /></label>
    </div>
    <div className="record-console-grid">
      <label>采样<select aria-label="记录模式" disabled={!sampling.supported} value={policy.mode} onChange={e => { const mode = e.target.value as SamplingPolicy['mode']; sampling.update({ ...policy, ...(mode === 'custom' ? {} : SAMPLING_PRESETS[mode]), mode }); }}><option value="power">省电</option><option value="standard">标准</option><option value="accuracy">高频</option><option value="custom">自定义</option></select></label>
      <NumberField label="精度≤m" value={preferences.maximum} min={5} max={80} disabled={!preferences.supported} onCommit={preferences.update} />
      <NumberField label="间隔秒" value={policy.intervalSeconds} min={1} max={30} disabled={!sampling.supported} onCommit={v => samplingNumber('intervalSeconds', v)} />
      <NumberField label="距离m" value={policy.distanceMetres} min={1} max={100} disabled={!sampling.supported} onCommit={v => samplingNumber('distanceMetres', v)} />
    </div>
    <small className="record-accuracy-hint">精度范围 5–80 米 · 越小越严格</small>
    <div className="record-console-checks">
      <label title="按距离记点，原地不补点"><input type="checkbox" checked={policy.distanceOnly} disabled={!sampling.supported} onChange={e => sampling.update({ ...policy, distanceOnly: e.target.checked })} />仅按距离</label>
      <label title="静止时降低定位频率，移动后恢复"><input type="checkbox" checked={policy.adaptive} disabled={!sampling.supported} onChange={e => sampling.update({ ...policy, adaptive: e.target.checked })} />静止降频</label>
      <label title="没有待处理记录时，开始导航自动开始新记录"><input type="checkbox" checked={policy.recordOnNavigation} disabled={!sampling.supported} onChange={e => sampling.update({ ...policy, recordOnNavigation: e.target.checked })} />导航时自动记录</label>
    </div>
  </div>;
}
