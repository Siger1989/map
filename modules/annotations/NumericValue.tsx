import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
export function NumericValue({
  label,
  value,
  min,
  max,
  step = 0.1,
  reset,
  change,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step?: number;
  reset: () => void;
  change: (n: number) => void;
}) {
  const formatted =
    value === null ? '' : String(Number(value.toFixed(step < 0.001 ? 6 : 2)));
  const [text, setText] = useState(formatted);
  useEffect(() => setText(formatted), [formatted]);
  return (
    <div className="marker-number">
      <input
        aria-label={label}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={text}
        placeholder="—"
        onChange={(e) => {
          setText(e.target.value);
          e.target.setCustomValidity('');
        }}
        onBlur={(e) => {
          const next = e.currentTarget.valueAsNumber;
          if (Number.isFinite(next) && next >= min && next <= max) {
            if (next !== value) change(next);
          } else {
            setText(formatted);
            e.currentTarget.setCustomValidity('');
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setText(formatted);
          }
        }}
      />
      <button
        type="button"
        aria-label={`${label}回正`}
        title={`仅重置${label}`}
        onClick={() => {
          reset();
        }}
      >
        <RotateCcw size={15} />
      </button>
    </div>
  );
}
