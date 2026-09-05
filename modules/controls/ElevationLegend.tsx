import { ELEVATION_COLORS } from '../terrain/elevationColors';

export function ElevationLegend() {
  return (
    <aside className="elevation-legend glass" aria-label="海拔颜色参考">
      <strong>
        海拔 <small>米</small>
      </strong>
      <div className="elevation-bands">
        {ELEVATION_COLORS.map(([height, color], index) => (
          <div
            key={height}
            title={`${height}–${ELEVATION_COLORS[index + 1]?.[0] ?? '以上'} 米`}
          >
            <i style={{ backgroundColor: color }} />
            <span>
              {height}
              {index === ELEVATION_COLORS.length - 1 ? '+' : ''}
            </span>
          </div>
        )).reverse()}
      </div>
    </aside>
  );
}
