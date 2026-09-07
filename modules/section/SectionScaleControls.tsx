import type { SectionSettings } from './types';
import { SECTION_SIZES, scaleLabel } from './scale';
export function SectionScaleControls({
  settings,
  onChange,
}: {
  settings: SectionSettings;
  onChange: (settings: SectionSettings) => void;
}) {
  const p = settings.plane!;
  const scale = settings.scale ?? {
      unit: 'm' as const,
      interval: 'auto' as const,
    },
    unitFactor = scale.unit === 'km' ? 1000 : 1;
  return (
    <section aria-label="比例尺设置" className="section-scale-controls">
      <strong>比例尺设置</strong>
      <div className="section-fields">
        <label className="section-field">
          单位
          <select
            aria-label="比例尺单位"
            value={scale.unit}
            onChange={(e) =>
              onChange({
                ...settings,
                scale: { ...scale, unit: e.target.value as 'm' | 'km' },
              })
            }
          >
            <option value="m">米 m</option>
            <option value="km">千米 km</option>
          </select>
        </label>
        <label className="section-field">
          间隔
          <select
            aria-label="刻度间隔"
            value={
              scale.interval === 'auto'
                ? 'auto'
                : SECTION_SIZES.includes(scale.interval)
                  ? scale.interval
                  : 'custom'
            }
            onChange={(e) => {
              const value = e.target.value;
              onChange({
                ...settings,
                scale: {
                  ...scale,
                  interval:
                    value === 'auto'
                      ? 'auto'
                      : value === 'custom'
                        ? 50
                        : Number(value),
                },
              });
            }}
          >
            <option value="auto">自动</option>
            {SECTION_SIZES.map((size) => (
              <option key={size} value={size}>
                {scaleLabel(size, scale.unit)} {scale.unit}
              </option>
            ))}
            <option value="custom">自定义</option>
          </select>
        </label>
      </div>
      {scale.interval !== 'auto' && (
        <label className="section-field">
          自定刻度间隔 {scale.unit}
          <input
            type="number"
            key={`${scale.unit}:${scale.interval}`}
            defaultValue={scale.interval / unitFactor}
            min={0.0001 / unitFactor}
            max={200000 / unitFactor}
            step="any"
            onBlur={(e) => {
              const value = e.currentTarget.valueAsNumber * unitFactor;
              if (Number.isFinite(value) && value >= 0.0001 && value <= 200000)
                onChange({ ...settings, scale: { ...scale, interval: value } });
              else
                e.currentTarget.value = String(
                  scale.interval === 'auto' ? '' : scale.interval / unitFactor,
                );
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </label>
      )}
      <p>
        图与方形面同步；刻度过密时显示间隔的整数倍，单位切换不改变实际尺寸。
      </p>
      <div className="section-fields section-size-presets">
        {(['width', 'height'] as const).map((axis) => (
          <label className="section-field" key={axis}>
            {axis === 'width' ? '宽度' : '高度'}
            <select
              aria-label={axis === 'width' ? '剖面宽度' : '剖面高度'}
              value={SECTION_SIZES.includes(p[axis]) ? p[axis] : 'custom'}
              onChange={(e) => {
                const size = Number(e.target.value);
                if (SECTION_SIZES.includes(size))
                  onChange({ ...settings, plane: { ...p, [axis]: size } });
              }}
            >
              <option value="custom" disabled>
                {Number(p[axis].toFixed(2))} m
              </option>
              {SECTION_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} m
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}
