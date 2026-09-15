import { useState } from 'react';
import './compactColor.css';
/** Inline RGB editor. Keeps the map available and never opens the browser's large color dialog. */
export function CompactColor({
  value,
  onChange,
  label = '自定义颜色',
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  const [draft, setDraft] = useState(value),
    valid = /^#[0-9a-f]{6}$/i.test(draft),
    base = valid ? draft : value;
  return (
    <div className="compact-color" role="group" aria-label={label}>
      <label>
        色值
        <input
          aria-label={label + '色值'}
          maxLength={7}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <i style={{ background: base }} />
      </label>
      {[0, 1, 2].map((i) => (
        <label key={i}>
          {['红', '绿', '蓝'][i]}
          <input
            aria-label={label + ['红', '绿', '蓝'][i]}
            type="range"
            min="0"
            max="255"
            value={parseInt(base.slice(1 + i * 2, 3 + i * 2), 16)}
            onChange={(e) =>
              setDraft(
                base.slice(0, 1 + i * 2) +
                  Number(e.target.value).toString(16).padStart(2, '0') +
                  base.slice(3 + i * 2),
              )
            }
          />
        </label>
      ))}
      <button disabled={!valid} onClick={() => onChange(draft.toLowerCase())}>
        应用颜色
      </button>
    </div>
  );
}
