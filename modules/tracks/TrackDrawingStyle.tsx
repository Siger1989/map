import { TRACK_WIDTHS, type TrackStyle } from './style';

/** Always-visible drawing appearance, one compact row using existing style state. */
export function TrackDrawingStyle({
  style,
  onChange,
  condition,
  onCondition,
}: {
  style: TrackStyle;
  onChange: (s: TrackStyle) => void;
  condition: string;
  onCondition: (s: string) => void;
}) {
  return (
    <div className="track-drawing-style" aria-label="画线外观">
      <label className="track-drawing-color" title="画线颜色">
        <input
          type="color"
          aria-label="画线颜色"
          value={style.color}
          onChange={(e) => onChange({ ...style, color: e.target.value })}
        />
      </label>
      <label title="画线线宽">
        <select
          aria-label="画线线宽"
          value={style.width}
          onChange={(e) =>
            onChange({ ...style, width: Number(e.target.value) })
          }
        >
          {TRACK_WIDTHS.map((n) => (
            <option key={n} value={n}>
              {n} px
            </option>
          ))}
        </select>
      </label>
      <input
        className="track-condition-input"
        aria-label="当前颜色路况备注"
        placeholder="路况 / 备注"
        maxLength={1600}
        value={condition}
        onChange={(e) => onCondition(e.target.value)}
      />
    </div>
  );
}
