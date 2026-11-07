import type { ChangeEvent } from 'react';

/** A compact route color trigger backed by the app-wide AppColorPicker. */
export function TrackColorPicker({
  value,
  onChange,
  label,
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  className?: string;
}) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => onChange(event.currentTarget.value);
  return (
    <label className={`track-color-picker ${className}`} title={label}>
      <i aria-hidden="true" style={{ backgroundColor: value }} />
      <span>{label}</span>
      {/* AppColorPicker intercepts this click and renders the shared palette/HEX dialog. */}
      <input type="color" aria-label={label} value={value} onChange={handleChange} />
    </label>
  );
}
