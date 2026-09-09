import { useEffect, useState } from 'react';
import { ObjectGizmo } from '../objectTransform/ObjectGizmo';
import { objectProjector, type ProjectionFrame, type WatchProjection } from '../objectTransform/projection';
import type { MeasurementState } from './useMeasurement';
import { lengthLabel, measurementMetrics, pointPose, type MeasurePoint } from './data';
import './measurement.css';

const coordinateLabel = (p: MeasurePoint) => `${p.coordinates[1].toFixed(6)}°, ${p.coordinates[0].toFixed(6)}°`;
export function Measurement({ state, watchProjection, projectGround, onBegin, onLocate }: {
  state: MeasurementState; watchProjection: WatchProjection; onBegin: () => void; onLocate: (point: MeasurePoint) => void;
  projectGround: (point: MeasurePoint) => { x: number; y: number } | null;
}) {
  const [frame, setFrame] = useState<ProjectionFrame | null>(null);
  useEffect(() => watchProjection(setFrame), [watchProjection]);
  const selected = state.points.find(p => p.id === state.selected);
  const points = state.points.map(p => p.id === state.selected && state.preview ? { ...p, ...state.preview } : p);
  const metrics = measurementMetrics(points), pose = selected && pointPose(selected);
  const screen = points.map(p => {
    const pose = pointPose(p);
    const ground = projectGround(p);
    return frame && pose ? objectProjector(frame, pose).center : ground ? { ...ground, visible: true } : null;
  });
  return <>
    <svg className="measurement-overlay" aria-label="测量折线" width="100%" height="100%">
      {screen.slice(1).map((p, i) => p?.visible && screen[i]?.visible ? <line key={`line-${points[i + 1].id}`} x1={screen[i]!.x} y1={screen[i]!.y} x2={p.x} y2={p.y} /> : null)}
      {screen.map((p, i) => p?.visible ? <g key={points[i].id} transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0} aria-label={`选择测量点 ${i + 1}`}
        onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); state.select(points[i].id); }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.select(points[i].id); } }}>
        <circle r="22" className="measurement-hit" /><circle r="10" fill={points[i].id === state.selected ? '#f5b544' : '#fff'} /><text textAnchor="middle" dy="4">{i + 1}</text>
      </g> : null)}
    </svg>
    {pose && !state.adding && <ObjectGizmo name="测量点" kind="measurement-point" pose={pose} watchProjection={watchProjection} hideToolbar canUndo={state.canUndo}
      onBegin={onBegin} onPreview={state.setPreview} onCommit={p => state.update(selected!.id, { coordinates: p.coordinates, altitude: p.altitude })}
      onUndo={state.undo} onClose={state.close} onDetails={() => {}} onLocate={() => onLocate(selected!)} />}
    <section className="measurement-panel" aria-label="路线测量" data-dragging={!!state.preview}>
      <header><strong>测量 · {points.length} 点</strong><button onClick={state.close} aria-label="关闭测量">关闭</button></header>
      <div className="measurement-scroll">
        <p className="measurement-hint">{state.adding ? '依次点地图连线；双指缩放、单指移图。' : '选择一个点，拖动 X/Y/Z 箭头调整位置和高度。'}</p>
        <div className="measurement-stats"><span>水平总长 <b>{lengthLabel(metrics.horizontal)}</b></span><span>空间总长 <b>{lengthLabel(metrics.spatial)}</b></span></div>
        <p>起终点方位角：<b>{metrics.bearing === null ? '—' : `${metrics.bearing.toFixed(1)}°`}</b> · 真北顺时针</p>
        {points.length > 0 && <details><summary>起点 / 终点与分段</summary><p>起点：{coordinateLabel(points[0])}</p><p>终点：{coordinateLabel(points.at(-1)!)}</p>
          {metrics.segments.map((s, i) => <p key={i}>{i + 1} → {i + 2}：{lengthLabel(s.horizontal)} · {s.bearing === null ? '—' : `${s.bearing.toFixed(1)}°`}</p>)}
          <small>空间长度按水平距离和两点高差估算，不是沿地表行走距离；地形海拔来自高程数据。</small></details>}
        {!!points.length && <label className="measurement-select">当前点<select aria-label="当前测量点" value={selected?.id ?? ''} onChange={e => state.select(e.target.value)}><option value="" disabled>选择一个点</option>{points.map((p, i) => <option key={p.id} value={p.id}>{i + 1}{i === 0 ? ' · 起点' : i === points.length - 1 ? ' · 终点' : ''}</option>)}</select><button disabled={!selected} onClick={() => selected && onLocate(selected)}>定位</button></label>}
        {selected && !state.adding && <PointFields key={`${selected.id}:${selected.coordinates}:${selected.altitude}`} point={selected} onChange={patch => state.update(selected.id, patch)} />}
        {points.some(p => p.altitude === null) && <small>部分海拔尚未取得；可选择该点填写海拔后启用三维控制。</small>}
        {state.error && <p role="alert">{state.error}</p>}
      </div>
      <footer><button aria-pressed={state.adding} onClick={() => state.setAdding(!state.adding)}>{state.adding ? '完成连线' : '继续添点'}</button><button disabled={!selected} onClick={state.remove}>删点</button><button disabled={!state.canUndo} onClick={state.undo}>撤销</button><button disabled={!points.length} onClick={state.clear}>新测量</button></footer>
    </section>
  </>;
}
function PointFields({ point, onChange }: { point: MeasurePoint; onChange: (patch: Partial<Pick<MeasurePoint, 'coordinates' | 'altitude'>>) => boolean }) {
  const [values, setValues] = useState([point.coordinates[0].toFixed(6), point.coordinates[1].toFixed(6), point.altitude?.toFixed(2) ?? '']);
  const [error, setError] = useState('');
  return <form className="measurement-fields" onSubmit={e => { e.preventDefault();
    if (values.some(v => !v.trim()) || !values.every(v => Number.isFinite(Number(v)))) { setError('请填写经度、纬度和海拔'); return; }
    if (onChange({ coordinates: [Number(values[0]), Number(values[1])], altitude: Number(values[2]) })) setError('');
  }}>
    {['经度', '纬度', '海拔 m'].map((name, i) => <label key={name}>{name}<input aria-label={`测量点${name}`} inputMode="decimal" type="number" step="any" value={values[i]} onChange={e => setValues(v => v.map((x, j) => i === j ? e.target.value : x))} /></label>)}
    <button type="submit">应用坐标</button>{error && <small role="alert">{error}</small>}
  </form>;
}
