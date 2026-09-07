import { useEffect, useState } from 'react';
import {
  DEFAULT_RECORDING_ACCURACY,
  LEGACY_RECORDING_ACCURACY,
  RECORDING_ACCURACY_KEY,
  readRecordingAccuracy,
  validRecordingAccuracy,
} from './recordingPreferences';

export function useRecordingPreferences() {
  const [maximum, setMaximum] = useState(DEFAULT_RECORDING_ACCURACY);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const bridge = window.GuanyunNative;
    const configurable =
      !bridge || (!!bridge.recordingAccuracy && !!bridge.setRecordingAccuracy);
    setSupported(configurable);
    try {
      setMaximum(
        bridge
          ? configurable
            ? readRecordingAccuracy(bridge.recordingAccuracy!())
            : LEGACY_RECORDING_ACCURACY
          : readRecordingAccuracy(
              JSON.parse(
                localStorage.getItem(RECORDING_ACCURACY_KEY) ?? 'null',
              ),
            ),
      );
    } catch {
      setError('记录精度设置未能读取，暂用默认门槛');
    }
  }, []);
  const update = (value: number) => {
    if (!supported) {
      setError('当前安装包不支持此设置，请更新后使用');
      return false;
    }
    if (!validRecordingAccuracy(value)) {
      setError('请输入5到80之间的整数（米）');
      return false;
    }
    try {
      const bridge = window.GuanyunNative;
      if (bridge) {
        if (
          !bridge.setRecordingAccuracy?.(value) ||
          bridge.recordingAccuracy?.() !== value
        )
          throw Error();
      } else {
        localStorage.setItem(RECORDING_ACCURACY_KEY, JSON.stringify(value));
        if (
          localStorage.getItem(RECORDING_ACCURACY_KEY) !== JSON.stringify(value)
        )
          throw Error();
      }
      setMaximum(value);
      setError('');
      return true;
    } catch {
      setError('设置保存失败，仍使用原门槛');
      return false;
    }
  };
  return { maximum, supported, error, update };
}
