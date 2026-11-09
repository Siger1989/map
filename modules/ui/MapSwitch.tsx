import type { ReactNode } from 'react';
import './mapSwitch.css';

/** Theme-aware switch for map actions and ordinary settings. */
export function MapSwitch({
  checked,
  onChange,
  label,
  size = 'setting',
  disabled = false,
  className,
  ariaLabel,
  ariaLabelledBy,
  inputId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  size?: 'map' | 'setting';
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  inputId?: string;
}) {
  return (
    <label className={`map-switch map-switch--${size}${className ? ` ${className}` : ''}`} data-checked={checked} data-disabled={disabled}>
      <input id={inputId} type="checkbox" role="switch" aria-label={ariaLabel} aria-labelledby={ariaLabelledBy} checked={checked} disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)} />
      <span className="map-switch__label">{label}</span>
      <span className="map-switch__track" aria-hidden="true"><span /></span>
    </label>
  );
}
