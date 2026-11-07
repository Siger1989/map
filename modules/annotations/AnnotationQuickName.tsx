import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';

/** Editing the quick title uses the same persisted name as the full editor. */
export function AnnotationQuickName({ id, name, disabled, onSave }: {
  id: string; name: string; disabled?: boolean; onSave: (name: string) => boolean;
}) {
  const [draft, setDraft] = useState(name);
  const latest = useRef(name);
  const composing = useRef(false);
  useEffect(() => { latest.current = name; setDraft(name); }, [id, name]);
  const save = () => {
    if (!composing.current && latest.current !== name) onSave(latest.current);
  };
  return <label className="selection-tools-name">
    <input aria-label="直接修改标记名称" title="点击修改名称，离开输入框自动保存" value={draft} maxLength={60}
      placeholder="未命名标记" disabled={disabled} autoComplete="off"
      onChange={event => { latest.current = event.target.value; setDraft(event.target.value); }} onBlur={save}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={event => {
        composing.current = false;
        latest.current = event.currentTarget.value;
        setDraft(latest.current);
        if (document.activeElement !== event.currentTarget) save();
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && !composing.current) event.currentTarget.blur();
      }} />
    <Pencil size={12} aria-hidden="true" />
  </label>;
}
