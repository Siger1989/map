import { SmartInput, SmartTextarea } from '../input/SmartText';
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronLeft, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { MARKER_ICONS, markerIcon } from './icons';
import { MAX_ATTRIBUTES } from './attributes';
import type { Annotation } from './data';
import { applyAnnotationPose, rotationDegrees, withRotationAxis, type Pose } from '../objectTransform/math';
import { editorPose, positionOffsets, withPositionOffset } from './editorSession';

type Change = (patch: Partial<Annotation>) => boolean;
export function AnnotationIcon({ item, size = 22 }: { item: Pick<Annotation, 'icon'>; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d={markerIcon(item.icon).path} /></svg>;
}

export function NumericValue({ label, value, min, max, step = 0.1, reset, change }: {
  label: string; value: number | null; min: number; max: number; step?: number;
  reset: () => void; change: (n: number) => void;
}) {
  const formatted = value === null ? '' : String(Number(value.toFixed(step < 0.001 ? 6 : 2)));
  const [text, setText] = useState(formatted);
  useEffect(() => setText(formatted), [formatted]);
  return <div className="marker-number">
    <input aria-label={label} type="number" inputMode="decimal" step={step} min={min} max={max}
      value={text} placeholder="—" onChange={(e) => { setText(e.target.value); e.target.setCustomValidity(''); }}
      onBlur={(e) => {
        const next = e.currentTarget.valueAsNumber;
        if (Number.isFinite(next) && next >= min && next <= max) { if (next !== value) change(next); }
        else { setText(formatted); e.currentTarget.setCustomValidity(''); }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(formatted); }
      }} />
    <button type="button" aria-label={`${label}回正`} title={`仅重置${label}`}
      onClick={() => { reset(); }}><RotateCcw size={15} /></button>
  </div>;
}

export function MarkerBasic({ item, base, change, terrainStatus }: {
  item: Annotation; base: Annotation; change: Change; terrainStatus?: string;
}) {
  const [picker, setPicker] = useState<'icon' | 'color' | null>(null);
  const colors = [['#f2b45f', '琥珀'], ['#ef5652', '珊瑚'], ['#5fdf79', '草绿'], ['#598fff', '天蓝'], ['#a379de', '紫色'], ['#ffffff', '白色']];
  if (picker) return <div className="marker-picker">
    <button onClick={() => setPicker(null)}><ChevronLeft size={16} />{picker === 'icon' ? '选择图标' : '选择颜色'}</button>
    <div className="marker-choice-grid">
      {picker === 'icon' ? Object.entries(MARKER_ICONS).map(([id, icon]) => <button key={id}
        aria-label={`图标 ${icon.name}`} aria-pressed={(item.icon ?? 'pin') === id}
        onClick={() => { if (change({ icon: id as Annotation['icon'] })) setPicker(null); }}>
        <AnnotationIcon item={{ icon: id as Annotation['icon'] }} /><small>{icon.name}</small>
      </button>) : colors.map(([color, name]) => <button key={color} aria-label={`颜色 ${name}`}
        aria-pressed={item.color === color} onClick={() => { if (change({ color })) setPicker(null); }}>
        <i style={{ background: color }} /><small>{name}</small>
      </button>)}
    </div>
    {picker === 'color' && <label className="marker-custom-color">自定义颜色<input type="color" aria-label="自定义标记颜色" value={item.color} onChange={(e) => change({ color: e.target.value })} /></label>}
  </div>;
  return <>
    <label className="marker-inline-field"><span>名称</span><SmartInput aria-label="标记名称" value={item.name} maxLength={60} onChange={(e) => change({ name: e.target.value })} /></label>
    <div className="marker-style-row">
      <button onClick={() => setPicker('icon')}><small>图标</small><AnnotationIcon item={item} size={18} /><span>{markerIcon(item.icon).name}</span><ChevronDown size={14} /></button>
      <button onClick={() => setPicker('color')}><small>颜色</small><i style={{ background: item.color }} /><span>{colors.find(([c]) => c === item.color)?.[1] ?? '自定'}</span><ChevronDown size={14} /></button>
    </div>
    {item.kind !== 'pin' && <details className="marker-model-options"><summary>模型尺寸与显示</summary>
      <div className="marker-model-grid">
        {([['width', item.kind === 'box' || item.kind === 'prism' ? '宽度 m' : '直径 m'],
          ...(item.kind === 'box' || item.kind === 'prism' ? [['length', '长度 m']] : []),
          ...(item.kind !== 'sphere' ? [['height', '高度 m']] : []), ['offset', item.placement === 'underground' ? '埋深 m' : '离地 m'], ['opacity', '不透明度']] as [keyof Annotation, string][])
          .map(([key, label]) => <label key={key}><span>{label}</span><NumericValue label={label} value={item[key] as number}
            min={key === 'offset' ? 0 : 0.1} max={key === 'opacity' ? 0.85 : 10000}
            change={(n) => change({ [key]: n })} reset={() => change({ [key]: base[key] })} /></label>)}
        <label><span>所在位置</span><select aria-label="模型所在位置" value={item.placement} onChange={(e) => change({ placement: e.target.value as Annotation['placement'] })}><option value="surface">地表外</option><option value="underground">地表内</option></select></label>
      </div>
      <label className="marker-check"><input type="checkbox" checked={item.terrainCut ?? item.placement === 'underground'} onChange={(e) => change({ terrainCut: e.target.checked })} />局部剖切地表</label>
      <label className="marker-check"><input type="checkbox" checked={item.terrainIntersection !== false} onChange={(e) => change({ terrainIntersection: e.target.checked })} />亮色显示山体交界</label>
      {terrainStatus && <small>{terrainStatus}</small>}
    </details>}
  </>;
}

export function MarkerPosition({ item, base, change, transform, origin: editOrigin }: {
  item: Annotation; base: Annotation; change: Change; transform: (item: Annotation) => boolean;
  origin?: Pose | null;
}) {
  const pose = editorPose(item), origin = editOrigin ?? editorPose(base);
  const [error, setError] = useState('');
  if (!pose || !origin) return <p role="status">请先在详情中读取或填写地面海拔，再调整模型。</p>;
  const offsets = positionOffsets(origin, pose), angles = rotationDegrees(pose);
  const axes = item.kind === 'pin' ? [0, 1] as const : [0, 1, 2] as const;
  const apply = (axis: 0 | 1 | 2, value: number, rotation = false) => {
    try {
      const next = rotation ? withRotationAxis(pose, axis, value) : withPositionOffset(origin, pose, axis, value);
      const updated = applyAnnotationPose(item, next);
      if (item.kind === 'pin') {
        // A location remains on the surface; do not modify historic orientation fields.
        change({ coordinates: updated.coordinates, groundElevation: null });
      } else transform(updated);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '位置超出支持范围'); }
  };
  return <div className="marker-position" data-kind={item.kind}>
    <div className="marker-axis-heading"><span /><div>{axes.map((axis) => <b key={axis} data-axis={axis}>{['X', 'Y', 'Z'][axis]}</b>)}</div></div>
    {[false, ...(item.kind === 'pin' ? [] : [true])].map((rotation) => <div key={String(rotation)} className="marker-axis-group">
      <span className="marker-axis-unit">{rotation ? '旋转 °' : '位移 m'}</span>
      <div className="marker-axis-values">{axes.map((axis) => <div key={axis} data-axis={axis}>
        <NumericValue label={`${['X', 'Y', 'Z'][axis]}${rotation ? '旋转角度' : '位移'}`}
          value={rotation ? angles[axis] : offsets[axis]} min={rotation ? -360 : -100000} max={rotation ? 360 : 100000}
          step={rotation ? 0.1 : 0.01} change={(n) => apply(axis, n, rotation)} reset={() => apply(axis, 0, rotation)} />
      </div>)}</div>
    </div>)}
    {error && <p role="alert" className="marker-error">{error}</p>}
  </div>;
}

export function MarkerData({ item, change }: { item: Annotation; change: Change }) {
  const fields = item.attributes ?? [];
  return <div className="marker-data">
    <div className="marker-data-heading"><span>自定义属性 · {fields.length}</span><button disabled={fields.length >= MAX_ATTRIBUTES}
      onClick={() => change({ attributes: [...fields, { name: '', value: '' }] })}><Plus size={16} />添加</button></div>
    {fields.map((field, i) => <div className="marker-attribute-row" key={i}>
      <SmartInput aria-label={`属性 ${i + 1} 名称`} placeholder="属性名" value={field.name} maxLength={60}
        onChange={(e) => change({ attributes: fields.map((v, n) => n === i ? { ...v, name: e.target.value } : v) })} />
      <SmartTextarea aria-label={`属性 ${i + 1} 数据`} placeholder="内容" value={field.value} rows={1} maxLength={2000}
        onChange={(e) => change({ attributes: fields.map((v, n) => n === i ? { ...v, value: e.target.value } : v) })} />
      <button aria-label={`删除属性 ${i + 1}`} onClick={() => change({ attributes: fields.filter((_, n) => n !== i) })}><Trash2 size={16} /></button>
    </div>)}
    <label className="marker-inline-field marker-note"><span>备注</span><SmartTextarea aria-label="标记备注" rows={1} maxLength={500} placeholder="补充说明…" value={item.note} onChange={(e) => change({ note: e.target.value })} /></label>
  </div>;
}

export function MarkerCoordinates({ item, base, change, refresh, reading }: {
  item: Annotation; base: Annotation; change: Change; refresh: () => void; reading: boolean;
}) {
  return <div className="marker-coordinate-fields">
    {([['经度', 0, -180, 180], ['纬度', 1, -85, 85]] as const).map(([label, index, min, max]) => <label key={index}><span>{label} °</span><NumericValue label={label} value={item.coordinates[index]} min={min} max={max} step={0.000001}
      change={(n) => { const coordinates = [...item.coordinates] as Annotation['coordinates']; coordinates[index] = n; change({ coordinates, groundElevation: null }); }}
      reset={() => { const coordinates = [...item.coordinates] as Annotation['coordinates']; coordinates[index] = base.coordinates[index]; change({ coordinates, groundElevation: null }); }} /></label>)}
    <label><span>地面海拔 m</span><NumericValue label="地面海拔" value={item.groundElevation} min={-12000} max={10000} change={(n) => change({ groundElevation: n })} reset={() => change({ groundElevation: base.groundElevation })} /></label>
    {item.centerAltitude !== undefined && <button onClick={() => change({ centerAltitude: undefined })}>恢复随地形放置</button>}
    <button onClick={refresh} disabled={reading}>{reading ? '读取地形…' : '重新读取地形海拔'}</button>
  </div>;
}
