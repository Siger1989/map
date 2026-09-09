import { SmartInput, SmartTextarea } from '../input/SmartText';
import { useEffect, useRef, useState } from 'react';
import { noteColor, type ProfileNote } from './profileNotes';
export function ProfileNoteEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: ProfileNote;
  onSave: (note: ProfileNote) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial),
    container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    container.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  const field = (
    index: number,
    key: 'name' | 'value' | 'unit',
    value: string,
  ) =>
    setDraft({
      ...draft,
      fields: draft.fields.map((f, i) =>
        i === index ? { ...f, [key]: value } : f,
      ),
    });
  return (
    <div
      className="section-note-editor"
      ref={container}
      aria-label="编辑交线测点"
    >
      <label className="section-field">
        测点颜色
        <input
          type="color"
          value={noteColor(draft)}
          onChange={(e) => setDraft({ ...draft, color: e.target.value })}
        />
      </label>
      <label className="section-field">
        测点名称
        <SmartInput
          value={draft.name}
          maxLength={80}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <p>
        经度 {draft.point.coordinates[0].toFixed(7)}° · 纬度{' '}
        {draft.point.coordinates[1].toFixed(7)}°<br />
        海拔 {draft.point.altitude.toFixed(2)} m · 沿线{' '}
        {draft.point.distance.toFixed(2)} m
      </p>
      <label className="section-field">
        测点备注
        <SmartTextarea
          value={draft.note}
          maxLength={1000}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
        />
      </label>
      {draft.fields.map((f, i) => (
        <div className="section-note-field" key={i}>
          <label className="section-field">
            数据名称
            <SmartInput
              aria-label={`数据 ${i + 1} 名称`}
              value={f.name}
              maxLength={80}
              onChange={(e) => field(i, 'name', e.target.value)}
            />
          </label>
          <label className="section-field">
            数值或内容
            <SmartInput
              aria-label={`数据 ${i + 1} 内容`}
              value={f.value}
              maxLength={500}
              onChange={(e) => field(i, 'value', e.target.value)}
            />
          </label>
          <label className="section-field">
            单位
            <SmartInput
              aria-label={`数据 ${i + 1} 单位`}
              value={f.unit}
              maxLength={40}
              onChange={(e) => field(i, 'unit', e.target.value)}
            />
          </label>
          <button
            aria-label={`删除数据 ${i + 1}`}
            onClick={() =>
              setDraft({
                ...draft,
                fields: draft.fields.filter((_, j) => i !== j),
              })
            }
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          setDraft({
            ...draft,
            fields: [...draft.fields, { name: '', value: '', unit: '' }],
          })
        }
      >
        ＋ 数据项
      </button>
      <div className="section-note-actions">
        <button
          onClick={() =>
            onSave({ ...draft, name: draft.name.trim() || '未命名测点' })
          }
        >
          保存测点
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
