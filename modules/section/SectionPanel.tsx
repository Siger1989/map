import { useEffect, useState } from 'react';
import type { SectionSettings, SectionStatus } from './types';
import { sectionOutline } from './appearance';
export function SectionPanel({
  settings,
  status,
  onAltitude,
  onColor,
  onClose,
  onRetry,
}: {
  settings: SectionSettings;
  status: SectionStatus;
  onAltitude: (height: number) => void;
  onColor: (color: string) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [text, setText] = useState(String(settings.altitude));
  useEffect(() => setText(String(settings.altitude)), [settings.altitude]);
  const change = (height: number) => {
    if (Number.isFinite(height))
      onAltitude(Math.max(-32768, Math.min(32767, height)));
  };
  const loading = status.phase === 'loading' || status.phase === 'idle';
  return (
    <>
      <aside className="section-slider glass" aria-label="海拔剖面控制">
        <strong>3D 海拔剖面</strong>
        <label htmlFor="section-height-number">切面海拔（米）</label>
        <input
          id="section-height-number"
          type="number"
          min={-32768}
          max={32767}
          step={0.1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          onBlur={() => {
            if (text.trim() && Number.isFinite(Number(text)))
              change(Number(text));
            else setText(String(settings.altitude));
          }}
        />
        <label className="section-color-control">
          剖面颜色
          <input
            type="color"
            aria-label="剖面颜色"
            value={settings.color}
            onChange={(event) => onColor(event.target.value)}
          />
        </label>
        <span>{Math.ceil(Math.max(status.max, settings.altitude))} m</span>
        <input
          className="section-height-range"
          type="range"
          aria-label="剖切海拔"
          aria-orientation="vertical"
          aria-valuetext={`${settings.altitude} 米`}
          min={Math.min(status.min, settings.altitude)}
          max={Math.max(status.max, settings.altitude)}
          step={0.1}
          value={settings.altitude}
          onChange={(event) => change(Number(event.target.value))}
        />
        <span>{Math.floor(Math.min(status.min, settings.altitude))} m</span>
        <div className="section-fine">
          <button
            aria-label="降低一米"
            onClick={() => change(settings.altitude - 1)}
          >
            −1 m
          </button>
          <button
            aria-label="升高一米"
            onClick={() => change(settings.altitude + 1)}
          >
            ＋1 m
          </button>
        </div>
        <button onClick={onClose}>退出剖面</button>
      </aside>
      <div className="section-caption glass">
        <strong>
          三维水平剖切 ·{' '}
          {settings.altitude.toLocaleString('zh-CN', {
            maximumFractionDigits: 1,
          })}{' '}
          m
        </strong>
        <p role="status">
          {loading
            ? '正在更新当前视野的三维切面…'
            : status.phase === 'error'
              ? '地形暂未取得，可重试加载'
              : `${status.phase === 'partial' ? '部分区域缺测 · ' : ''}当前视野 · 约 ${Math.max(1, Math.round(status.spacing)).toLocaleString('zh-CN')} m 采样间距`}
        </p>
        <div className="section-key">
          <span>
            <i
              className="section-solid"
              style={{ background: settings.color }}
            />
            山体切面
          </span>
          <span>
            <i
              className="section-rim"
              style={{ background: sectionOutline(settings.color) }}
            />
            剖切边缘
          </span>
        </div>
        <p>
          移除海拔以上部分，保留下面的三维地形；彩色为模型截面。可旋转、倾斜查看，移动后更新视野。剖切按真实海拔
          1× 显示。
        </p>
        {(status.phase === 'error' || status.phase === 'partial') && (
          <button onClick={onRetry}>重新加载当前视野</button>
        )}
      </div>
    </>
  );
}
