import { useId } from 'react';
import { TRACK_COLORS, type TrackStyle } from './style';
export function TrackStyleControls({
  style,
  onChange,
}: {
  style: TrackStyle;
  onChange: (style: TrackStyle) => void;
}) {
  const id = useId();
  return (
    <div className="track-style-controls">
      <label htmlFor={id} className="slider-label">
        线宽 <span>{style.width}px</span>
      </label>
      <input
        id={id}
        aria-label="轨迹线宽"
        type="range"
        min="0.5"
        max="5"
        step="0.5"
        value={style.width}
        onChange={(e) => onChange({ ...style, width: Number(e.target.value) })}
      />
      <label htmlFor={`${id}-opacity`} className="slider-label">
        透明度 <span>{Math.round((1 - (style.opacity ?? 1)) * 100)}%</span>
      </label>
      <input
        id={`${id}-opacity`}
        aria-label="轨迹透明度"
        type="range"
        min="0"
        max="90"
        step="5"
        value={Math.round((1 - (style.opacity ?? 1)) * 100)}
        onChange={(e) =>
          onChange({ ...style, opacity: 1 - Number(e.target.value) / 100 })
        }
      />
      <div className="track-color-options" role="group" aria-label="轨迹颜色">
        {TRACK_COLORS.map((color, i) => (
          <button
            key={color}
            aria-label={['橙色', '红色', '蓝色', '绿色', '黄色', '白色'][i]}
            aria-pressed={style.color === color}
            onClick={() => onChange({ ...style, color })}
          >
            <i style={{ background: color }} />
          </button>
        ))}
        <label className="track-custom-color" title="自定义颜色">
          <input
            type="color"
            aria-label="自定义轨迹颜色"
            value={style.color}
            onChange={(e) => onChange({ ...style, color: e.target.value })}
          />
          <span>自定</span>
        </label>
      </div>
      <svg
        className="track-style-sample"
        viewBox="0 0 180 14"
        aria-label={`线条预览，${style.width}像素`}
      >
        <path
          d="M 4 9 Q 30 0 57 7 T 100 5 T 176 7"
          fill="none"
          stroke={style.color}
          strokeOpacity={style.opacity ?? 1}
          strokeWidth={style.width}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
