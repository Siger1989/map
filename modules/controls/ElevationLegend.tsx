import { ELEVATION_COLORS } from '../terrain/elevationColors';

export function ElevationLegend() {
  return (
    <aside className="elevation-legend glass" aria-label="海拔颜色参考">
      <strong>
        海拔 <small>米 · 每50米细分</small>
      </strong>
      <div className="elevation-bands">
        {ELEVATION_COLORS.map(([height, color], index) => (
          <div
            key={height}
            title={`${height}–${ELEVATION_COLORS[index + 1]?.[0] ?? '以上'} 米 · 区间内每50米一个色阶`}
          >
            <i
              style={{
                background: `linear-gradient(to top, ${color}, ${ELEVATION_COLORS[index + 1]?.[1] ?? color})`,
              }}
            />
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
