import { isLayoutInteraction } from '../uiLayout/events';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
import type { useRouteDisplay } from './useRouteDisplay';
import type { RouteDisplayPreferences } from './preferences';
import {
  ANALYSIS_POLICY,
} from '../routeAnalysis/config';
import './routeDisplay.css';
type Display = ReturnType<typeof useRouteDisplay>;

export function RouteDisplaySettings({
  display,
  onClose,
  navigating = false,
  embedded = false,
  compact,
}: {
  display: Display;
  onClose: () => void;
  navigating?: boolean;
  embedded?: boolean;
  compact?: 'drawing';
}) {
  const drawing = compact === 'drawing';
  const isEmbedded = embedded || drawing;
  const root = useRouteDialogFocus(onClose, embedded && !drawing ? '.guidance-card' : undefined);
  useEffect(() => {
    if (isEmbedded) return;
    const dismiss = (event: PointerEvent) => {
      if (isLayoutInteraction(event)) return;
      if (event.target instanceof Node && !root.current?.contains(event.target))
        onClose();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [onClose, root, isEmbedded]);
  const { preferences, target } = display;
  return (
        <section
          ref={root}
          className={`route-display-settings glass${navigating ? ' route-display-settings--navigation' : ''}${drawing ? ' route-display-settings--drawing' : ''}`}
          aria-label="路线显示设置面板"
          data-embedded={isEmbedded}
          data-scope={compact ?? 'default'}
        >
          {!embedded && <header>
            <strong>路线显示</strong>
            <button aria-label="关闭路线显示设置" onClick={onClose}>
              <X size={15} />
            </button>
          </header>}
          <div className="route-display-scroll">
            {navigating || drawing ? <p className="route-display-scope">{drawing ? '当前绘制路线' : '当前导航路线'}</p> : <label>
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
            </label>}
            <label className={navigating ? 'route-display-color' : undefined}>
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
                  ['legend', '底部路线色标'],
                  ['statistics', '底部海拔数据'],
                  ['profile', '底部海拔曲线'],
                  ['steep', '陡坡标记'],
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
            {!drawing && <details className="route-display-explanation">
              <summary>显示说明</summary>
              <div>
                <p>前三项在选中路线或导航时显示于底部；全部关闭可隐藏底栏。</p>
                <p>
                  选中的路线生效，开关自动保存。高程缺失时读取地形；灰色为缺测。
                  陡坡≥
                  {(
                    (Math.atan(ANALYSIS_POLICY.steepThresholdPercent / 100) * 180) /
                    Math.PI
                  ).toFixed(1)}
                  °，上下坡分开提示。
                </p>
                <p>海拔按本路线最低至最高渐变；坡角按约5.7°和11.3°分档，同档同色。</p>
              </div>
            </details>}
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
  );
}
