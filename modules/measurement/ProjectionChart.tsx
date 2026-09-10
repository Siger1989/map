import { lengthLabel, pointLabel, type segmentMetrics } from './data';

/** A permanently visible chart, outside the scrolling measurement controls. */
export function ProjectionChart({
  metrics,
  segment,
  total,
  saved,
  hint,
  reading,
  onRetry,
}: {
  metrics: ReturnType<typeof segmentMetrics> | undefined;
  segment: number;
  total: number | null;
  saved: boolean;
  hint: string | null;
  reading: boolean;
  onRetry: () => void;
}) {
  const known = !!metrics && metrics.rise !== null;
  const flat = metrics?.rise === 0;
  const ay = flat ? 32 : metrics && metrics.rise! < 0 ? 16 : 46;
  const by = flat ? 32 : 62 - ay;
  return (
    <figure className="measurement-chart" aria-label="测量投影剖面图">
      <figcaption>
        <strong>投影剖面</strong>
        <span>
          {metrics
            ? `${pointLabel(segment)} → ${pointLabel(segment + 1)}`
            : '等待选点'}
        </span>
        <small>示意 · 非等比</small>
      </figcaption>
      {metrics ? (
        <>
          <div
            className="measurement-chart-metrics"
            aria-label="当前线段测量结果"
          >
            <strong>
              {metrics.inclination === null
                ? '—'
                : `${metrics.inclination.toFixed(1)}°`}
              <small> 水平夹角</small>
            </strong>
            <span>
              朝向{' '}
              {metrics.bearing === null
                ? '—'
                : `${metrics.bearing.toFixed(1)}°`}
            </span>
          </div>
          <p className="measurement-chart-distance">
            水平 {lengthLabel(metrics.horizontal)} · 高差{' '}
            {metrics.rise === null
              ? '—'
              : `${metrics.rise >= 0 ? '+' : ''}${metrics.rise.toFixed(1)} m`}
          </p>
          {known ? (
            <svg
              className="measurement-chart-plot"
              viewBox="0 0 240 66"
              role="img"
              aria-label={`${pointLabel(segment)}到${pointLabel(segment + 1)}水平参考线与垂直投影，非等比`}
            >
              <path
                className="measurement-chart-grid"
                d="M22 16H200 M22 32H200 M22 46H200 M66 10V54 M110 10V54 M154 10V54"
              />
              <path
                className="measurement-chart-reference"
                d={`M22 ${ay} H200 V${by}`}
              />
              <path
                className="measurement-chart-slope"
                d={`M22 ${ay} L200 ${by}`}
              />
              {!flat && (
                <path
                  className="measurement-chart-reference"
                  d={`M192 ${ay} v${by > ay ? 8 : -8} h8`}
                />
              )}
              <circle cx="22" cy={ay} r="3" fill="#d4a02b" />
              <circle cx="200" cy={by} r="3" fill="#3478ed" />
              <text x="7" y={ay + 4}>
                {pointLabel(segment)}
              </text>
              <text x="209" y={by + 4}>
                {pointLabel(segment + 1)}
              </text>
              <text x="100" y={ay < 32 ? 10 : 62} textAnchor="middle">
                {flat ? '连线与水平线重合' : '水平线'}
              </text>
              {!flat && (
                <text x="206" y="35">
                  投影
                </text>
              )}
            </svg>
          ) : (
            <div className="measurement-chart-empty">
              <button disabled={reading} onClick={onRetry}>
                {reading ? '读取地面海拔中…' : '海拔暂无 · 点击重试'}
              </button>
              <small>取得两点海拔后显示投影</small>
            </div>
          )}
        </>
      ) : (
        <div className="measurement-chart-empty">
          添加两个点后，自动显示水平线与投影
        </div>
      )}
      <p className="measurement-chart-note">
        {hint ??
          `${total !== null ? `总水平 ${lengthLabel(total)} · ` : ''}${saved ? '已保存到地图和收藏夹' : '拖动测点调整，按点标签切换线段'}`}
      </p>
    </figure>
  );
}
