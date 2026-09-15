import { useEffect, useState } from 'react';
import { SAMPLING_PRESETS, type SamplingPolicy } from './samplingPolicy';
import type { useSamplingPolicy } from './useSamplingPolicy';
import './sampling.css';

export function SamplingSettings({
  settings,
  native,
}: {
  settings: ReturnType<typeof useSamplingPolicy>;
  native: boolean;
}) {
  const [draft, setDraft] = useState(settings.policy);
  useEffect(() => setDraft(settings.policy), [settings.policy]);
  const labels = {
    power: '省电',
    standard: '标准',
    accuracy: '高频',
    custom: '自定义',
  };
  return (
    <details className="recording-precision sampling-settings">
      <summary>
        记录频率 · {labels[settings.policy.mode]}
        {settings.policy.distanceOnly ? ' · 按距离' : ''}
      </summary>
      <label className="slider-label">
        频率
        <select
          aria-label="记录频率"
          disabled={!settings.supported}
          value={draft.mode}
          onChange={(event) => {
            const mode = event.target.value as SamplingPolicy['mode'];
            setDraft({
              ...draft,
              ...(mode === 'custom' ? {} : SAMPLING_PRESETS[mode]),
              mode,
            });
          }}
        >
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {draft.mode === 'custom' && (
        <div className="outdoor-actions recording-precision-row">
          <label>
            间隔（秒）
            <input
              aria-label="记录间隔秒"
              type="number"
              min={1}
              max={30}
              value={draft.intervalSeconds}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  intervalSeconds: Number(event.target.value),
                })
              }
            />
          </label>
          <label>
            距离（米）
            <input
              aria-label="记录距离米"
              type="number"
              min={1}
              max={100}
              value={draft.distanceMetres}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  distanceMetres: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
      )}
      <label className="check-row">
        <input
          type="checkbox"
          checked={draft.distanceOnly}
          onChange={(event) =>
            setDraft({ ...draft, distanceOnly: event.target.checked })
          }
        />
        按距离记点，原地不补点
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={draft.adaptive}
          onChange={(event) =>
            setDraft({ ...draft, adaptive: event.target.checked })
          }
        />
        静止60秒后降频，移动后恢复
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={draft.recordOnNavigation}
          onChange={(event) =>
            setDraft({ ...draft, recordOnNavigation: event.target.checked })
          }
        />
        开始导航时自动开始新记录
      </label>
      <div className="outdoor-actions">
        <button
          disabled={!settings.supported}
          onClick={() => settings.update(draft)}
        >
          应用记录频率
        </button>
      </div>
      <p className="route-note">
        {native
          ? '模式调整定位请求间隔，高频更耗电。'
          : '网页仅筛选记录点；省电效果需在安卓手机测试。'}
        自动开始仅在没有待处理记录时生效。
      </p>
      {!settings.supported && (
        <p className="route-note">当前安装包不支持记录频率设置。</p>
      )}
      {settings.error && (
        <p role="status" className="route-error">
          {settings.error}
        </p>
      )}
    </details>
  );
}
