import { useEffect, useId, useState } from 'react';
import type { useRecordingPreferences } from './useRecordingPreferences';

export function RecordingPrecision({
  preferences,
}: {
  preferences: ReturnType<typeof useRecordingPreferences>;
}) {
  const [input, setInput] = useState(String(preferences.maximum));
  const inputId = useId();
  useEffect(() => setInput(String(preferences.maximum)), [preferences.maximum]);
  return (
    <details className="recording-precision">
      <summary>记录精度 · 估计误差 ≤{preferences.maximum} 米</summary>
      <label htmlFor={inputId}>允许记录的最大估计误差（米）</label>
      <div className="outdoor-actions recording-precision-row">
        <input
          id={inputId}
          aria-label="允许记录的最大估计误差（米）"
          type="number"
          min={5}
          max={80}
          step={1}
          inputMode="numeric"
          value={input}
          disabled={!preferences.supported}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          disabled={!preferences.supported}
          onClick={() => preferences.update(Number(input))}
        >
          应用精度设置
        </button>
        <button
          disabled={!preferences.supported}
          onClick={() => {
            if (preferences.update(20)) setInput('20');
          }}
        >
          恢复20米
        </button>
      </div>
      <p className="route-note">
        5–80米，默认20米；保存后对新定位点生效。数值越小筛选越严格，弱信号时可能长时间不记点。这是接受门槛，不是定位精度保证。
      </p>
      {!preferences.supported && (
        <p className="route-note">当前安装包仍使用80米门槛，请升级后设置。</p>
      )}
      {preferences.error && (
        <p role="status" className="route-error">
          {preferences.error}
        </p>
      )}
    </details>
  );
}
