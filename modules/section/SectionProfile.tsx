'use client';
import { useEffect, useState } from 'react';
import {
  pointOnContour,
  type ProfilePoint,
  type SectionProfileData,
} from './contours';
import { chartFrame, downloadProfile, profileDetails } from './profileExport';
import type { SectionSettings } from './types';

type Props = {
  data: SectionProfileData | null;
  settings: SectionSettings;
  onCursor: (p: ProfilePoint | null) => void;
  onChange: (s: SectionSettings) => void;
  onClose: () => void;
  onRetry: () => void;
};
export function SectionProfile({
  data,
  settings,
  onCursor,
  onChange,
  onClose,
  onRetry,
}: Props) {
  const [id, setId] = useState(''),
    [fraction, setFraction] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const current = data?.settings === settings ? data : null;
  const curves = current?.curves ?? [],
    curve = curves.find((c) => c.id === id) ?? curves[0];
  const point =
    curve && current ? pointOnContour(curve, fraction, current.settings) : null;
  const f = chartFrame(curves, 300, 112);
  useEffect(() => {
    onCursor(point);
    return () => onCursor(null);
  }, [current, curve?.id, fraction]);
  useEffect(() => setMessage(''), [settings, curve?.id]);
  const download = async () => {
    if (!current || !curve || !point) return;
    setBusy(true);
    setMessage('');
    try {
      setMessage(await downloadProfile(current, curve, point));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '图片保存失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    change: (n: number) => void,
  ) => (
    <label className="section-field" key={label}>
      {label}
      <input
        type="number"
        defaultValue={Number(value.toFixed(7))}
        key={value}
        min={min}
        max={max}
        step="any"
        onBlur={(e) => {
          const n = e.currentTarget.valueAsNumber;
          if (Number.isFinite(n) && n >= min && n <= max) {
            if (n !== Number(value.toFixed(7))) change(n);
          } else e.currentTarget.value = String(Number(value.toFixed(7)));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
  const p = settings.plane!;
  return (
    <section
      className="section-profile glass"
      role="dialog"
      aria-label="剖面交线详情"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header>
        <strong>剖面交线</strong>
        <button disabled={!curve || busy} onClick={download}>
          {busy ? '生成中…' : '保存图片'}
        </button>
        <button aria-label="关闭剖面详情" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="section-profile-body">
        {curves.length > 0 ? (
          <>
            <select
              aria-label="选择交线"
              value={curve.id}
              onChange={(e) => {
                setId(e.target.value);
                setFraction(0);
              }}
            >
              {curves.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.source === 'terrain' ? '地形' : '模型'}
                </option>
              ))}
            </select>
            <svg
              className="section-chart"
              viewBox="0 0 300 112"
              role="img"
              aria-label="交界轮廓图，横轴U纵轴V为剖面内米数"
            >
              <rect
                x=".5"
                y=".5"
                width="299"
                height="111"
                rx="5"
                fill="#102532"
                stroke="#52756e"
              />
              {curves.map((c) => (
                <polyline
                  key={c.id}
                  points={c.points.map((p) => `${f.x(p)},${f.y(p)}`).join(' ')}
                  fill="none"
                  stroke={c.id === curve.id ? '#ffb85f' : '#5e8f83'}
                  strokeWidth={c.id === curve.id ? 2 : 1}
                />
              ))}
              {point && (
                <circle
                  cx={f.x(point)}
                  cy={f.y(point)}
                  r="4"
                  fill="white"
                  stroke="#ffb85f"
                />
              )}
              <text x="5" y="12">
                V / m
              </text>
              <text x="266" y="105">
                U / m
              </text>
            </svg>
            <label className="section-scrubber">
              沿交线选点
              <input
                aria-label="沿交线查看点海拔"
                type="range"
                min="0"
                max="1000"
                step="1"
                value={Math.round(fraction * 1000)}
                onChange={(e) => setFraction(Number(e.target.value) / 1000)}
              />
            </label>
            <output className="section-readout" aria-live="polite">
              海拔 <b>{point?.altitude.toFixed(2)} m</b> · 沿线{' '}
              {point?.distance.toFixed(1)} m<br />
              经度 {point?.coordinates[0].toFixed(7)}° · 纬度{' '}
              {point?.coordinates[1].toFixed(7)}°
            </output>
          </>
        ) : (
          <p role="status">
            {!current || current.phase === 'loading'
              ? '正在计算交线…'
              : current.phase === 'error'
                ? '交线计算失败，可重试。'
                : current.valid === 0
                  ? '地形尚未加载，当前也没有模型交线。'
                  : '当前矩形范围内没有交线，可移动或拉伸剖面。'}
          </p>
        )}
        {current?.phase === 'partial' && (
          <p className="section-partial">
            地形覆盖不完整，缺失处留空；模型交线仍可查看。
          </p>
        )}
        {message && <p role="status">{message}</p>}
        <details>
          <summary>坐标、海拔与数据详情</summary>
          <dl>
            {current &&
              profileDetails(current, curve, point).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
          </dl>
        </details>
        <details>
          <summary>精确设置剖面</summary>
          <div className="section-fields">
            {number('中心经度', p.center[0], -180, 180, (n) =>
              onChange({
                ...settings,
                plane: { ...p, center: [n, p.center[1]] },
              }),
            )}
            {number('中心纬度', p.center[1], -85, 85, (n) =>
              onChange({
                ...settings,
                plane: { ...p, center: [p.center[0], n] },
              }),
            )}
          </div>
          <div className="section-fields">
            {number('中心海拔 m', settings.altitude, -12000, 30000, (n) =>
              onChange({ ...settings, altitude: n }),
            )}
            {number('宽 m', p.width, 0.1, 200000, (n) =>
              onChange({ ...settings, plane: { ...p, width: n } }),
            )}
            {number('高 m', p.height, 0.1, 200000, (n) =>
              onChange({ ...settings, plane: { ...p, height: n } }),
            )}
          </div>
          <div className="section-fields">
            {number('方向 °', p.heading, -360, 360, (n) =>
              onChange({ ...settings, plane: { ...p, heading: n } }),
            )}
            {number('倾角 °', p.tilt, -90, 90, (n) =>
              onChange({ ...settings, plane: { ...p, tilt: n } }),
            )}
            {number('面内转角 °', p.roll ?? 0, -360, 360, (n) =>
              onChange({ ...settings, plane: { ...p, roll: n } }),
            )}
          </div>
        </details>
        <button onClick={onRetry}>重新采样</button>
        <p>
          点地图上的矩形面可再次打开。图内 U/V 是面内距离，海拔以选点读数为准。
        </p>
      </div>
    </section>
  );
}
