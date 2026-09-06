import { useState } from 'react';
import type { SectionSettings, SectionStatus } from './types';
export function SectionPanel({
  settings,
  status,
  onChange,
  onClose,
  onRetry,
  onCenter,
}: {
  settings: SectionSettings;
  status: SectionStatus;
  onChange: (settings: SectionSettings) => void;
  onClose: () => void;
  onRetry: () => void;
  onCenter: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [group, setGroup] = useState<'position' | 'angle' | 'size'>('angle');
  const plane = settings.plane!;
  const patch = (key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    if (key === 'altitude')
      onChange({
        ...settings,
        altitude: Math.max(-12000, Math.min(20000, value)),
      });
    else onChange({ ...settings, plane: { ...plane, [key]: value } });
  };
  const field = (
    name: string,
    key: string,
    value: number,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label className="section-field">
      {name}
      <input
        type="number"
        aria-label={name}
        min={min}
        max={max}
        step={step}
        value={Math.round(value * 10) / 10}
        onChange={(e) => {
          if (e.target.value !== '')
            patch(key, Math.max(min, Math.min(max, Number(e.target.value))));
        }}
      />
    </label>
  );
  return (
    <>
      <aside className="section-panel glass" aria-label="矩形剖面控制">
        <header>
          <strong>矩形剖面</strong>
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? '收起' : '调整'}
          </button>
          <button onClick={onClose} aria-label="退出剖面">
            退出
          </button>
        </header>
        {!expanded && <p>拖中心移动 · 拉角点缩放</p>}
        {expanded && (
          <div className="section-panel-body">
            <nav aria-label="切面参数分组">
              {(
                [
                  ['position', '位置'],
                  ['angle', '角度'],
                  ['size', '尺寸'],
                ] as const
              ).map(([key, title]) => (
                <button
                  key={key}
                  aria-pressed={group === key}
                  onClick={() => setGroup(key)}
                >
                  {title}
                </button>
              ))}
            </nav>
            {group === 'position' && (
              <>
                <div className="section-fields">
                  {field(
                    '中心海拔（米）',
                    'altitude',
                    settings.altitude,
                    -12000,
                    20000,
                  )}
                  <button onClick={onCenter}>移到视野中心</button>
                </div>
                <p>拖动 ✥ 平移位置，海拔控制上下移动。</p>
              </>
            )}
            {group === 'angle' && (
              <>
                <label className="section-range">
                  方位 {Math.round(plane.heading)}°
                  <input
                    type="range"
                    aria-label="切面方位"
                    min={-180}
                    max={180}
                    value={plane.heading}
                    onChange={(e) => patch('heading', +e.target.value)}
                  />
                </label>
                <label className="section-range">
                  倾斜 {Math.round(plane.tilt)}°
                  <input
                    type="range"
                    aria-label="切面倾斜"
                    min={-90}
                    max={90}
                    value={plane.tilt}
                    onChange={(e) => patch('tilt', +e.target.value)}
                  />
                </label>
                <label className="section-range">
                  面内 {Math.round(plane.roll ?? 0)}°
                  <input
                    type="range"
                    aria-label="切面面内旋转"
                    min={-180}
                    max={180}
                    value={plane.roll ?? 0}
                    onChange={(e) => patch('roll', +e.target.value)}
                  />
                </label>
                <div className="section-presets">
                  <button onClick={() => patch('tilt', 0)}>竖直</button>
                  <button onClick={() => patch('tilt', 90)}>水平</button>
                </div>
              </>
            )}
            {group === 'size' && (
              <>
                <div className="section-fields">
                  {field('宽度（米）', 'width', plane.width, 50, 200000, 50)}
                  {field('高度（米）', 'height', plane.height, 50, 30000, 50)}
                </div>
                <label className="section-color-control">
                  剖面颜色
                  <input
                    type="color"
                    aria-label="剖面颜色"
                    value={settings.color}
                    onChange={(e) =>
                      onChange({ ...settings, color: e.target.value })
                    }
                  />
                </label>
              </>
            )}
          </div>
        )}
      </aside>
      <div
        className="section-caption glass"
        role="status"
        data-phase={status.phase}
      >
        <strong>裁去靠近视点的一侧</strong>
        {(status.phase === 'loading' || status.phase === 'idle') && (
          <span>等待地形…</span>
        )}
        {(status.phase === 'partial' || status.phase === 'error') && (
          <>
            <span>
              {status.phase === 'error' ? '裁切暂不可用' : '部分地形未加载'}
            </span>
            <button onClick={onRetry}>重试</button>
          </>
        )}
      </div>
    </>
  );
}
