import { useEffect, useRef, useState } from 'react';
import { ChartNoAxesCombined, X } from 'lucide-react';
import type { useRouteDisplay } from './useRouteDisplay';
import type { RouteDisplayPreferences } from './preferences';
import { ELEVATION_RAMP } from '../routeAnalysis/elevationColors';
import { SPEED_BANDS, SLOPE_BANDS } from '../routeAnalysis/config';
import { RouteElevationProfile } from './RouteElevationProfile';
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
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);
  const { preferences, target, mode, scale, stats, samples } = display;
  const source = !stats.available
    ? '暂无高程'
    : display.estimated
      ? '含地形估算'
      : '轨迹自带高程';
  const close = () => {
    setOpen(false);
    toggle.current?.focus({ preventScroll: true });
  };
  return (
    <div
      className="route-display-control"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={toggle}
        className="position-dock-button glass"
        aria-label="路线显示设置"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChartNoAxesCombined size={17} />
        <small>海拔显示</small>
      </button>
      {open && (
        <section
          className="route-display-settings glass"
          aria-label="路线显示设置面板"
        >
          <header>
            <strong>路线显示</strong>
            <button aria-label="关闭路线显示设置" onClick={close}>
              <X size={15} />
            </button>
          </header>
          <div className="route-display-scroll">
            <label>
              路线
              <select
                aria-label="显示设置作用路线"
                value={target?.id ?? ''}
                onChange={(e) => display.choose(e.target.value)}
              >
                {!target && <option value="">先规划、导入或选择路线</option>}
                {display.candidates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              着色
              <select
                aria-label="地图路线着色"
                value={preferences.mode}
                onChange={(e) =>
                  display.update({
                    mode: e.target.value as RouteDisplayPreferences['mode'],
                  })
                }
              >
                <option value="original">原有样式</option>
                <option value="solid">单色</option>
                <option value="elevation">海拔</option>
                <option value="speed">速度</option>
                <option value="slope">坡度</option>
              </select>
            </label>
            <div className="route-display-options">
              {(
                [
                  ['legend', '颜色图例'],
                  ['statistics', '海拔与爬升'],
                  ['profile', '海拔剖面'],
                  ['steep', '陡坡标记'],
                  ['coordinates', '底部定位坐标'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={preferences[key]}
                    onChange={(e) =>
                      display.update({ [key]: e.target.checked })
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
            <p>
              选中的路线生效，开关自动保存。高程缺失时读取地形；灰色为缺测。陡坡仅是采样提示。
            </p>
            <p>海拔按本路线最低至最高渐变；坡度按10%和20%分档，同档同色。</p>
            <button
              onClick={display.refresh}
              disabled={display.loading || !target}
            >
              刷新路线高程
            </button>
            {display.error && <p role="alert">{display.error}</p>}
            {display.elevationError && (
              <p role="alert">{display.elevationError}</p>
            )}
          </div>
        </section>
      )}
      {target && !blocked && (
        <aside className="route-display-info" aria-label="地图路线信息">
          {display.loading && (
            <small role="status" className="glass">
              读取路线高程…
            </small>
          )}
          {display.elevationError && (
            <small className="glass" role="status">
              {display.elevationError}
            </small>
          )}
          {preferences.legend && mode !== 'solid' && (
            <section
              className="route-color-legend glass"
              aria-label="路线颜色图例"
            >
              <strong>
                {mode === 'elevation'
                  ? '路线海拔 · m'
                  : mode === 'speed'
                    ? '路线速度 · km/h'
                    : '路线坡度 · %'}
              </strong>
              {mode === 'elevation' ? (
                <>
                  <div
                    className="route-color-ramp"
                    style={{
                      background:
                        scale && scale.min === scale.max
                          ? ELEVATION_RAMP[2]
                          : `linear-gradient(90deg, ${ELEVATION_RAMP.join(',')})`,
                    }}
                  />
                  <div className="route-color-ticks">
                    <span>{metres(scale?.min ?? null)}</span>
                    <span>
                      {scale ? metres((scale.min + scale.max) / 2) : '缺测'}
                    </span>
                    <span>{metres(scale?.max ?? null)}</span>
                  </div>
                </>
              ) : (
                <div className="route-band-legend">
                  {(mode === 'speed' ? SPEED_BANDS : SLOPE_BANDS).map(
                    (b, i) => (
                      <span key={b.color}>
                        <i style={{ background: b.color }} />
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
              <small>
                {mode === 'speed' ? '需逐点时间' : source} · 灰色缺测
              </small>
            </section>
          )}
          {preferences.statistics && (
            <section
              className="route-elevation-stats glass"
              aria-label="路线海拔统计"
            >
              <span>
                海拔 {metres(stats.min)}–{metres(stats.max)}
              </span>
              <span>
                爬升 {metres(stats.ascent)} · 下降 {metres(stats.descent)}
              </span>
              <small>
                {source}
                {!stats.complete ? ' · 部分缺测' : ''}
              </small>
            </section>
          )}
          {preferences.profile && (
            <RouteElevationProfile samples={samples} scale={scale} />
          )}
        </aside>
      )}
    </div>
  );
}
