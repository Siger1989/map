import type { RouteStyle } from './types';
import { resolveRouteStyle, routeWidthOptions } from './routeStyleControls.ts';
import './routeStyleQuickControls.css';

export function RouteStyleQuickControls({ style, onChange }: {
  style?: RouteStyle;
  onChange: (style: RouteStyle) => void;
}) {
  const current = resolveRouteStyle(style);
  const widths = routeWidthOptions(current.width);
  return <div className="route-style-quick-controls" aria-label="规划路线样式">
    <label title="路线颜色">
      <span>颜色</span>
      <input type="color" aria-label="路线颜色" value={current.color}
        onChange={(event) => onChange({ ...current, color: event.target.value })} />
    </label>
    <label title="路线粗细">
      <span>宽</span>
      <select aria-label="路线粗细" value={current.width} onChange={(event) => onChange({ ...current, width: Number(event.target.value) })}>
        {widths.map((width) => <option key={width} value={width}>{width}</option>)}
      </select>
    </label>
  </div>;
}
