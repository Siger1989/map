import { useEffect, useState } from 'react';
import {
  DEFAULT_RECORDING_ACCURACY,
  LEGACY_RECORDING_ACCURACY,
  RECORDING_ACCURACY_KEY,
  readRecordingAccuracy,
  validRecordingAccuracy,
} from './recordingPreferences';
import { configureMacRecording, macBridge, readMacRecordingConfig } from '../platform/macNative';

export function useRecordingPreferences() {
  const [maximum, setMaximum] = useState(DEFAULT_RECORDING_ACCURACY);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (macBridge()) {
      let active = true;
      void readMacRecordingConfig().then(config => {
        if (!active) return;
        if (!validRecordingAccuracy(config.maximumAccuracy)) throw new Error('macOS 记录精度配置无效');
        setMaximum(readRecordingAccuracy(config.maximumAccuracy));
        setSupported(true);
        setError('');
      }).catch(e => {
        if (active) { setSupported(false); setError(e instanceof Error ? e.message : 'macOS 记录配置暂不可用'); }
      });
      return () => { active = false; };
    }
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
  const update = async (value: number) => {
    if (macBridge()) {
      if (!validRecordingAccuracy(value)) { setError('请输入5到80之间的整数（米）'); return false; }
      setPending(true); setError('正在保存 macOS 记录精度…');
      try {
        const config = await configureMacRecording({ maximumAccuracy: value });
        setMaximum(readRecordingAccuracy(config.maximumAccuracy)); setError(''); return true;
      } catch (e) { setError(e instanceof Error ? e.message : 'macOS 设置保存失败'); return false; }
      finally { setPending(false); }
    }
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
  return { maximum, supported, error, pending, update };
}
