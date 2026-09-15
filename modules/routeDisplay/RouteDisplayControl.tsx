import { createPortal } from 'react-dom';
import { useBackHandler } from '../controls/backNavigation';
import { useRef, useState } from 'react';
import { ChartNoAxesCombined, X } from 'lucide-react';
import type { useRouteDisplay } from './useRouteDisplay';
import type { RouteDisplayPreferences } from './preferences';
import { ELEVATION_RAMP } from '../routeAnalysis/elevationColors';
import { SPEED_BANDS, SLOPE_BANDS } from '../routeAnalysis/config';
import { RouteElevationProfile } from './RouteElevationProfile';
import { TrackStyleControls } from '../tracks/TrackStyleControls';
import './routeDisplay.css';
type Display = ReturnType<typeof useRouteDisplay>;
const metres = (v: number | null) => (v === null ? '—' : `${Math.round(v)}m`);
export function RouteDisplayControl({
  display,
  blocked,
}: {
  display: Display;
  blocked: boolean;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState('display');
  const { preferences, target, mode, scale, stats, samples } = display;
  const root = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLElement>(null);
  useBackHandler(open && !!target, panel, () => setOpen(false));
  const source = !stats.available
    ? '暂无高程'
    : display.estimated
      ? '含地形估算'
      : '轨迹自带高程';
  const profile = preferences.profile || preferences.statistics;
  return (
    <div
      ref={root}
      className="route-display-control"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        className="position-dock-button glass"
        aria-label="路线显示设置"
        aria-expanded={open}
        disabled={!target}
        onClick={() => setOpen(!open)}
      >
        <ChartNoAxesCombined size={17} />
        <small>路线显示</small>
      </button>
      {open &&
        target &&
        createPortal(
          <section
            ref={panel}
            className="route-display-settings glass"
            aria-label="路线显示设置面板"
          >
            <header>
              <strong>路线显示</strong>
              <button
                aria-label="关闭路线显示设置"
                onClick={() => setOpen(false)}
              >
                <X size={15} />
              </button>
            </header>
            <div className="route-display-scroll">
              <label>
                对象
                <select
                  aria-label="显示设置作用路线"
                  value={target.id}
                  onChange={(e) => display.choose(e.target.value)}
                >
                  {display.candidates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="route-display-tabs" role="tablist">
                {[
                  ['display', '显示方式'],
                  ['line', '线条'],
                  ['info', '图上信息'],
                ].map(([id, label]) => (
                  <button
                    role="tab"
                    aria-selected={tab === id}
                    key={id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'display' && (
                <label>
                  显示方式
                  <select
                    aria-label="路线显示方式"
                    value={
                      preferences.mode === 'speed' && !display.allowSpeed
                        ? 'solid'
                        : preferences.mode
                    }
                    onChange={(e) =>
                      display.update({
                        mode: e.target.value as RouteDisplayPreferences['mode'],
                      })
                    }
                  >
                    <option value="original">原样</option>
                    <option value="solid">单色</option>
                    <option value="elevation">海拔</option>
                    {display.allowSpeed && <option value="speed">速度</option>}
                    <option value="slope">坡度</option>
                  </select>
                </label>
              )}
              {tab === 'line' && (
                <TrackStyleControls
                  style={display.lineStyle}
                  onChange={display.updateLineStyle}
                />
              )}
              {tab === 'info' && (
                <>
                  <div className="route-display-options">
                    <label>
                      <input
                        type="checkbox"
                        checked={preferences.legend}
                        onChange={(e) =>
                          display.update({ legend: e.target.checked })
                        }
                      />
                      颜色图例
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={profile}
                        onChange={(e) =>
                          display.update({
                            profile: e.target.checked,
                            statistics: e.target.checked,
                          })
                        }
                      />
                      海拔图
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={preferences.steep}
                        onChange={(e) =>
                          display.update({ steep: e.target.checked })
                        }
                      />
                      陡坡标记
                    </label>
                  </div>
                  <small>{source}</small>
                  <button onClick={display.refresh} disabled={display.loading}>
                    刷新高程
                  </button>
                  <details>
                    <summary>数据说明</summary>
                    <p>
                      陡坡阈值20%（约11.3°），上下坡分别标记。灰色为缺测；海拔图曲线沿用对应海拔颜色。
                    </p>
                  </details>
                </>
              )}
              {display.error && <p role="alert">{display.error}</p>}
              {display.elevationError && (
                <p role="alert">{display.elevationError}</p>
              )}
            </div>
          </section>,
          document.body,
        )}
      {target && !blocked && (
        <aside className="route-display-info" aria-label="地图路线信息">
          {display.loading && (
            <small className="glass" role="status">
              读取高程…
            </small>
          )}
          {preferences.legend &&
            mode !== 'solid' &&
            !(profile && mode === 'elevation') && (
              <section
                className="route-color-legend glass"
                aria-label="路线颜色图例"
              >
                <strong>
                  {mode === 'elevation'
                    ? '海拔 / m'
                    : mode === 'speed'
                      ? '速度 / km/h'
                      : '坡度 / %'}
                </strong>
                {mode === 'elevation' ? (
                  <>
                    <div
                      className="route-color-ramp"
                      style={{
                        background: `linear-gradient(90deg, ${ELEVATION_RAMP.join(',')})`,
                      }}
                    />
                    <div className="route-color-ticks">
                      <span>{metres(scale?.min ?? null)}</span>
                      <span>{metres(scale?.max ?? null)}</span>
                    </div>
                  </>
                ) : (
                  <div className="route-band-legend">
                    {(mode === 'speed' ? SPEED_BANDS : SLOPE_BANDS).map(
                      (band, i) => (
                        <span key={band.color}>
                          <i style={{ background: band.color }} />
                          {
                            (mode === 'speed'
                              ? ['<3', '3–6', '≥6']
                              : ['<10', '10–20', '≥20'])[i]
                          }
                        </span>
                      ),
                    )}
                  </div>
                )}
              </section>
            )}
          {profile && (
            <section
              className="route-elevation-combined glass"
              aria-label="路线海拔图"
            >
              <header>
                <span>
                  海拔 {metres(stats.min)}–{metres(stats.max)}
                </span>
                <span>
                  ↑ {metres(stats.ascent)}　↓ {metres(stats.descent)}
                </span>
              </header>
              <RouteElevationProfile samples={samples} scale={scale} />
              <small>
                {source}
                {!stats.complete ? ' · 部分缺测' : ''}
              </small>
            </section>
          )}
        </aside>
      )}
    </div>
  );
}
