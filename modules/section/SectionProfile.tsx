'use client';
import { useEffect, useState, useRef } from 'react';
import {
  pointOnContour,
  type ProfilePoint,
  type SectionProfileData,
} from './contours';
import { profileImages, profileDetails } from './profileExport';
import { deliverPhoto } from '../photos/export';
import { ProfileImagePages } from './ProfileImagePages';
import type { SectionSettings } from './types';
import { ProfileChart } from './ProfileChart';
import { SectionScaleControls } from './SectionScaleControls';
import { ProfileNoteEditor } from './ProfileNoteEditor';
import { useProfileNotes } from './useProfileNotes';
import {
  sectionKey,
  nextNoteColor,
  noteColor,
  previewProfileNotes,
  type ProfileNote,
} from './profileNotes';
import { ContourScrubber } from './ContourScrubber';
import { moveProfileNote } from './notePosition';
import type { PointActions } from './useContourPointDrag';

type Props = {
  name?: string;
  data: SectionProfileData | null;
  settings: SectionSettings;
  onCursor: (p: ProfilePoint | null) => void;
  onChange: (s: SectionSettings) => void;
  onRestore: (s: SectionSettings) => void;
  onClose: () => void;
  onRetry: () => void;
  onHide: () => void;
  onDelete: () => void;
};
export function SectionProfile({
  name = '剖面交线',
  data,
  settings,
  onCursor,
  onChange,
  onRestore,
  onClose,
  onRetry,
  onHide,
  onDelete,
}: Props) {
  const [id, setId] = useState(''),
    [fraction, setFraction] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [draft, setDraft] = useState<ProfileNote | null>(null),
    [dragged, setDragged] = useState<ProfileNote | null>(null),
    [activeNote, setActiveNote] = useState('');
  const saved = useProfileNotes(settings),
    key = sectionKey(settings);
  const scaleControls = useRef<HTMLDivElement>(null);
  const exportJob = useRef<AbortController | null>(null);
  const [imagePages, setImagePages] = useState<File[]>([]);
  useEffect(() => () => exportJob.current?.abort(), []);
  const current = data?.settings === settings ? data : null;
  const curves = current?.curves ?? [],
    curve = curves.find((c) => c.id === id) ?? curves[0];
  const point =
    curve && current ? pointOnContour(curve, fraction, current.settings) : null;
  const displayedNotes = dragged
    ? saved.notes.map((n) => (n.id === dragged.id ? dragged : n))
    : saved.notes;
  const focusedNote = displayedNotes.find((n) => n.id === activeNote),
    cursor = focusedNote?.point ?? point;
  const focusedCurve = focusedNote
    ? curves.find(
        (c) =>
          c.name === focusedNote.curveName && c.source === focusedNote.source,
      )
    : curve;
  useEffect(() => {
    setDraft(null);
    setDragged(null);
    setActiveNote('');
  }, [key]);
  useEffect(() => {
    onCursor(cursor);
    return () => onCursor(null);
  }, [current, curve?.id, fraction, activeNote, saved.notes, dragged]);
  useEffect(() => setMessage(''), [settings, curve?.id]);
  const download = async () => {
    if (!current || !curve || !cursor || exportJob.current) return;
    const job = new AbortController();
    exportJob.current = job;
    setBusy(true);
    setMessage('正在生成剖面与平面地图，请保持联网…');
    setImagePages([]);
    try {
      const pages: File[] = [];
      for await (const file of profileImages(
        current,
        focusedCurve,
        cursor,
        saved.notes,
        job.signal,
        name,
      ))
        pages.push(file);
      job.signal.throwIfAborted();
      if (pages.length === 1) setMessage(await deliverPhoto(pages[0], false));
      else {
        setImagePages(pages);
        setMessage(`数据较多，已生成 ${pages.length} 张完整图片，请逐张保存。`);
      }
    } catch (e) {
      if (!job.signal.aborted)
        setMessage(e instanceof Error ? e.message : '图片保存失败，请重试');
    } finally {
      exportJob.current = null;
      if (!job.signal.aborted) setBusy(false);
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
  const addPoint = () => {
    if (!point || !curve || !current) return;
    setActiveNote('');
    const occupied = saved.notes.filter(
      (n) => n.curveName === curve.name && n.source === curve.source,
    );
    const available =
      [fraction, ...Array.from({ length: 19 }, (_, i) => (i + 1) / 20)].find(
        (f) =>
          occupied.every(
            (n) =>
              Math.abs(
                f - (n.fraction ?? n.point.distance / (curve.length || 1)),
              ) > 0.04,
          ),
      ) ?? fraction;
    const added = moveProfileNote(
      {
        id: crypto.randomUUID(),
        color: nextNoteColor(saved.notes),
        name: `测点 ${saved.notes.length + 1}`,
        note: '',
        fields: [],
        point: structuredClone(point),
        curveName: curve.name,
        source: curve.source,
        sampledAt: current.createdAt,
      },
      curve,
      available,
      settings,
      current.createdAt,
    );
    if (saved.save(added.id, added)) {
      setActiveNote(added.id);
      setMessage('已增加彩色拖动点；点按选择，拖动调整，点“数据”填写信息。');
    }
  };
  const removePoint = (id: string) => {
    if (saved.save(id, null)) {
      if (draft?.id === id) setDraft(null);
      if (activeNote === id) setActiveNote('');
      setDragged(null);
    }
  };
  const pointActions: PointActions = {
    disabled: !!draft,
    onSelect: (note) => {
      setActiveNote(note.id);
    },
    onEdit: (note) => {
      const selected = curves.find(
        (c) => c.name === note.curveName && c.source === note.source,
      );
      if (selected) setId(selected.id);
      setActiveNote(note.id);
      setDraft(note);
    },
    onPreview: (note) => {
      setDragged(note);
      setActiveNote(note.id);
      previewProfileNotes(
        settings,
        saved.notes.map((n) => (n.id === note.id ? note : n)),
      );
    },
    onCommit: (note) => {
      setDragged(null);
      setActiveNote(note.id);
      if (!saved.save(note.id, note))
        previewProfileNotes(settings, saved.notes);
    },
    onCancel: () => {
      setDragged(null);
      previewProfileNotes(settings, saved.notes);
    },
  };
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
        <strong>{name}</strong>
        <button disabled={!curve || busy} onClick={download}>
          {busy ? '生成中…' : '保存图片'}
        </button>
        <button aria-label="关闭剖面详情" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="section-profile-body">
        {imagePages.length > 1 && <ProfileImagePages files={imagePages} />}
        {curves.length > 0 ? (
          <>
            <select
              aria-label="选择交线"
              value={curve.id}
              onChange={(e) => {
                setId(e.target.value);
                setFraction(0);
                setActiveNote('');
              }}
            >
              {curves.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.source === 'terrain' ? '地形' : '模型'}
                </option>
              ))}
            </select>
            <ProfileChart
              curves={curves}
              curveId={curve.id}
              point={cursor}
              notes={displayedNotes}
              onAdd={addPoint}
              canAdd={!!point && saved.ready && !draft}
              settings={settings}
              sampledAt={current?.createdAt ?? 0}
              actions={pointActions}
              onRemove={() => removePoint(activeNote)}
              onEdit={() => {
                if (focusedNote) pointActions.onEdit(focusedNote);
              }}
              canRemove={!!focusedNote && !dragged}
              onScale={() =>
                scaleControls.current?.scrollIntoView({ block: 'start' })
              }
            />
            <ContourScrubber
              curve={curve}
              settings={settings}
              sampledAt={current?.createdAt ?? 0}
              notes={displayedNotes}
              fraction={fraction}
              onFraction={(n) => {
                setFraction(n);
                setActiveNote('');
              }}
              actions={pointActions}
            />
            <output className="section-readout" aria-live="polite">
              {focusedNote ? `${focusedNote.name} · ` : ''}海拔{' '}
              <b>{cursor?.altitude.toFixed(2)} m</b> · 沿线{' '}
              {cursor?.distance.toFixed(1)} m<br />
              经度 {cursor?.coordinates[0].toFixed(7)}° · 纬度{' '}
              {cursor?.coordinates[1].toFixed(7)}°
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
        <div ref={scaleControls}>
          <SectionScaleControls settings={settings} onChange={onChange} />
        </div>
        {current?.phase === 'partial' && (
          <p className="section-partial">
            地形覆盖不完整，缺失处留空；模型交线仍可查看。
          </p>
        )}
        {message && <p role="status">{message}</p>}
        {saved.error && (
          <p className="section-partial" role="alert">
            {saved.error}
          </p>
        )}
        {draft && (
          <ProfileNoteEditor
            key={draft.id}
            initial={draft}
            onCancel={() => setDraft(null)}
            onSave={(note) => {
              if (saved.save(note.id, note)) {
                setDraft(null);
                setActiveNote(note.id);
                setMessage('测点已保存到本机，保存图片会包含全部测点。');
              }
            }}
          />
        )}
        {saved.notes.length > 0 && (
          <div className="section-notes" aria-label="已保存测点">
            <p>点按彩色点选中，拖动调整位置；“数据”编辑，“－”删除。</p>
            {saved.notes.map((n, i) => (
              <div className="section-note-row" key={n.id}>
                <button
                  aria-label={`编辑测点 ${n.name}`}
                  onClick={() => {
                    pointActions.onEdit(n);
                  }}
                >
                  <b style={{ color: noteColor(n, i) }}>
                    {i + 1} · {n.name}
                  </b>
                  <small>
                    海拔 {n.point.altitude.toFixed(2)} m · {n.fields.length}{' '}
                    项数据
                  </small>
                </button>
                <button
                  aria-label={`删除测点 ${n.name}`}
                  onClick={() => removePoint(n.id)}
                >
                  －
                </button>
              </div>
            ))}
          </div>
        )}
        {saved.records.length > 0 && (
          <label className="section-field">
            已保存测点的剖面
            <select
              value={
                saved.records.some((s) => sectionKey(s.settings) === key)
                  ? key
                  : ''
              }
              onChange={(e) => {
                const record = saved.records.find(
                  (s) => sectionKey(s.settings) === e.target.value,
                );
                if (record) onRestore({ ...record.settings, enabled: true });
              }}
            >
              <option value="" disabled>
                选择原剖面以查看测点
              </option>
              {saved.records.map((s) => (
                <option
                  key={sectionKey(s.settings)}
                  value={sectionKey(s.settings)}
                >
                  {s.notes.length} 点 ·{' '}
                  {Number(s.settings.plane!.width.toFixed(1))}×
                  {Number(s.settings.plane!.height.toFixed(1))} m ·{' '}
                  {s.settings.plane!.center.map((n) => n.toFixed(4)).join(', ')}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="section-options">
          <details>
            <summary aria-label="坐标、海拔与数据详情">坐标与数据</summary>
            <dl>
              {current &&
                profileDetails(current, focusedCurve, cursor).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          </details>
          <details>
            <summary aria-label="精确设置剖面">精确设置</summary>
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
        </div>
        <div className="section-note-actions section-footer-actions">
          <button onClick={onRetry}>重新采样</button>
          <button onClick={onHide}>隐藏剖面</button>
          <button onClick={onDelete}>删除剖面</button>
        </div>
        <p>
          点地图上的矩形面可再次打开。图内 U/V 是面内距离，海拔以选点读数为准。
        </p>
      </div>
    </section>
  );
}
