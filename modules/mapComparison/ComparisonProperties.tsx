import { useState, type FormEvent } from 'react';
import type { Annotation } from '../annotations/data';
import { MARKER_ICONS, markerSolidPath, type MarkerIconId } from '../annotations/icons';
import { TRACK_WIDTHS, type TrackStyle } from '../tracks/style';
import './comparisonProperties.css';

export function ComparisonLineProperties({
  style,
  onChange,
  onClose,
}: {
  style: TrackStyle;
  onChange: (style: TrackStyle) => void;
  onClose: () => void;
}) {
  const opacity = Math.max(0.1, Math.min(1, style.opacity ?? 1));
  return (
    <section className="map-comparison-property comparison-line-properties" aria-label="对比路线样式">
      <header className="comparison-property-heading">
        <strong>路线样式</strong>
        <button type="button" aria-label="关闭路线样式" onClick={onClose}>×</button>
      </header>
      <div className="comparison-line-basics">
      <label className="comparison-property-row">
        <span>颜色</span>
        <input
          type="color"
          aria-label="对比路线颜色"
          value={style.color}
          onChange={event => onChange({ ...style, color: event.target.value })}
        />
      </label>
      <label className="comparison-property-row">
        <span>线宽</span>
        <select
          aria-label="对比路线线宽"
          value={style.width}
          onChange={event => onChange({ ...style, width: Number(event.target.value) })}
        >
          {TRACK_WIDTHS.map(width => <option key={width} value={width}>{width} px</option>)}
        </select>
      </label>
      </div>
      <label className="comparison-property-row comparison-opacity-row">
        <span>透明度</span>
        <input
          type="range"
          aria-label="对比路线透明度"
          min="0.1"
          max="1"
          step="0.05"
          value={opacity}
          onChange={event => onChange({ ...style, opacity: Number(event.target.value) })}
        />
        <output>{Math.round(opacity * 100)}%</output>
      </label>
    </section>
  );
}

type MarkerEditorProps = {
  annotation: Annotation;
  onSave: (id: string, patch: Pick<Annotation, 'name' | 'note' | 'color' | 'icon'>) => boolean;
  onClose: () => void;
  error?: string;
};

export function ComparisonMarkerEditor(props: MarkerEditorProps) {
  return <ComparisonMarkerDraft key={props.annotation.id} {...props} />;
}

function ComparisonMarkerDraft({ annotation, onSave, onClose, error }: MarkerEditorProps) {
  const [draft, setDraft] = useState(() => ({
    name: annotation.name,
    note: annotation.note,
    color: annotation.color,
    ...(annotation.icon ? { icon: annotation.icon } : {}),
  }));
  const [saveError, setSaveError] = useState('');
  const [choosingIcon, setChoosingIcon] = useState(false);
  const message = error || saveError;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (onSave(annotation.id, draft)) onClose();
    else setSaveError('保存失败，请重试');
  };

  return (
    <section className="map-comparison-property comparison-marker-editor" aria-label="编辑对比标记">
      {choosingIcon ? <>
        <header className="comparison-property-heading">
          <button type="button" aria-label="返回标记编辑" onClick={() => setChoosingIcon(false)}>‹</button>
          <strong>选择符号</strong>
          <button type="button" aria-label="关闭标记编辑" onClick={onClose}>×</button>
        </header>
        <div className="comparison-symbol-grid" aria-label="标记符号选择">
          {(Object.keys(MARKER_ICONS) as MarkerIconId[]).map(id => <button
            key={id}
            type="button"
            aria-label={MARKER_ICONS[id].name}
            title={MARKER_ICONS[id].name}
            aria-pressed={(draft.icon ?? 'pin') === id}
            onClick={() => {
              setDraft(current => ({ ...current, icon: id }));
              setSaveError('');
              setChoosingIcon(false);
            }}
          ><svg viewBox="0 0 24 24" aria-hidden="true"><path d={markerSolidPath(id)} fill="currentColor" fillRule="evenodd" /></svg></button>)}
        </div>
      </> : <form onSubmit={save}>
        <header className="comparison-property-heading">
          <input
            className="comparison-marker-name-input"
            aria-label="标记名称"
            placeholder="标记名称"
            value={draft.name}
            maxLength={60}
            onChange={event => { setDraft(current => ({ ...current, name: event.target.value })); setSaveError(''); }}
          />
          <label className="comparison-marker-color" title="标记颜色">
            <input
              type="color"
              aria-label="标记颜色"
              value={draft.color}
              onChange={event => { setDraft(current => ({ ...current, color: event.target.value })); setSaveError(''); }}
            />
          </label>
          <button type="button" aria-label="关闭标记编辑" onClick={onClose}>×</button>
        </header>
        <div className="comparison-marker-details">
          <button type="button" className="comparison-marker-symbol" aria-label="标记符号" title={`选择符号：${MARKER_ICONS[draft.icon ?? 'pin'].name}`} onClick={() => setChoosingIcon(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={markerSolidPath(draft.icon)} fill="currentColor" fillRule="evenodd" /></svg>
          </button>
          <textarea
            aria-label="标记备注"
            placeholder="备注"
            rows={1}
            value={draft.note}
            maxLength={500}
            onChange={event => { setDraft(current => ({ ...current, note: event.target.value })); setSaveError(''); }}
          />
        </div>
        {message && <p className="comparison-property-error" role="alert">{message}</p>}
        <footer className="comparison-marker-actions">
          <button className="comparison-marker-save" type="submit">保存</button>
          <button type="button" onClick={onClose}>取消</button>
        </footer>
      </form>}
    </section>
  );
}
