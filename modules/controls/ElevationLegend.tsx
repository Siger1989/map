import { ELEVATION_COLORS } from '../terrain/elevationColors';

export function ElevationLegend() {
  return (
    <aside className="elevation-legend glass" aria-label="海拔颜色参考">
      <strong>
        海拔 <small>米</small>
      </strong>
      <div className="elevation-bands">
        {ELEVATION_COLORS.map(([height, color], index) => (
          <div key={height}>
            <i style={{ backgroundColor: color }} />
            <span>
              {height.toLocaleString()}
              {index < ELEVATION_COLORS.length - 1
                ? `–${ELEVATION_COLORS[index + 1][0].toLocaleString()}`
                : '+'}
            </span>
          </div>
        )).reverse()}
      </div>
      <p>分段设色 · 原始海拔</p>
    </aside>
  );
}
