import type { RouteStyle } from './types';
import { resolveRouteStyle, routeColorOptions, routeWidthOptions } from './routeStyleControls.ts';
import './routeStyleQuickControls.css';

const PALETTE = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#f781bf'];
const COLOR_NAMES = ['红', '蓝', '绿', '紫', '橙', '粉'];

export function RouteStyleQuickControls({ style, onChange }: {
  style?: RouteStyle;
  onChange: (style: RouteStyle) => void;
}) {
  const current = resolveRouteStyle(style);
  const colors = routeColorOptions(current.color);
  const widths = routeWidthOptions(current.width);
  return <div className="route-style-quick-controls" aria-label="规划路线样式">
    <label title="路线颜色">
      <span>颜色</span>
      <select aria-label="路线颜色" value={current.color} onChange={(event) => onChange({ ...current, color: event.target.value })}>
        {colors.map((color) => <option key={color} value={color}>{COLOR_NAMES[PALETTE.indexOf(color)] ?? color.toUpperCase()}</option>)}
      </select>
      <i aria-hidden="true" style={{ backgroundColor: current.color }} />
      <span aria-hidden="true">⌄</span>
    </label>
    <label title="路线粗细">
      <span>宽</span>
      <select aria-label="路线粗细" value={current.width} onChange={(event) => onChange({ ...current, width: Number(event.target.value) })}>
        {widths.map((width) => <option key={width} value={width}>{width}</option>)}
      </select>
    </label>
  </div>;
}
