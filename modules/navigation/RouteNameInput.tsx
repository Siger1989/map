import { useEffect, useState } from 'react';
import './routeNameInput.css';

/** Keep an unfinished name local until blur/Enter; IME composition stays intact. */
export function RouteNameInput({ name, onSave }: {
  name: string;
  onSave: (name: string) => boolean;
}) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState(false);
  useEffect(() => { setDraft(name); setError(false); }, [name]);
  const save = () => {
    const value = draft.trim();
    if (!value) { setDraft(name); setError(false); return; }
    if (value === name) { setError(false); return; }
    const ok = onSave(value);
    setError(!ok);
    if (ok) setDraft(value);
  };
  return <input className="route-header-name" aria-label="路线名称" autoComplete="off"
    value={draft} maxLength={60} aria-invalid={error || undefined}
    title={error ? '名称未保存，请重试；修改仍保留在输入框中' : '自动按起终点命名，可直接修改'}
    onChange={event => { setDraft(event.target.value); setError(false); }}
    onBlur={save}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(name); setError(false); }
    }} />;
}
