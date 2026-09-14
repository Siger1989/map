import { useEffect, useState } from 'react';
import {
  DEFAULT_SAMPLING,
  SAMPLING_KEY,
  validSampling,
  type SamplingPolicy,
} from './samplingPolicy';

export function useSamplingPolicy() {
  const [policy, setPolicy] = useState(DEFAULT_SAMPLING);
  const [supported, setSupported] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const bridge = window.GuanyunNative;
    const supported =
      !bridge || !!(bridge.recordingSampling && bridge.setRecordingSampling);
    setSupported(supported);
    if (!supported) return;
    try {
      const raw = bridge
        ? bridge.recordingSampling!()
        : localStorage.getItem(SAMPLING_KEY);
      if (!raw) return;
      const next = JSON.parse(raw);
      if (!validSampling(next)) throw Error();
      setPolicy(next);
    } catch {
      setError('采样设置无法读取，暂用标准模式');
    }
  }, []);
  const update = (next: SamplingPolicy) => {
    if (!supported || !validSampling(next)) {
      setError('采样参数无效或安装包不支持');
      return false;
    }
    try {
      const raw = JSON.stringify(next),
        bridge = window.GuanyunNative;
      if (bridge) {
        if (!bridge.setRecordingSampling?.(raw)) throw Error();
        const actual = JSON.parse(bridge.recordingSampling!());
        if (
          !validSampling(actual) ||
          (Object.keys(next) as (keyof SamplingPolicy)[]).some(
            (key) => actual[key] !== next[key],
          )
        )
          throw Error();
      } else localStorage.setItem(SAMPLING_KEY, raw);
      setPolicy(next);
      setError('');
      return true;
    } catch {
      setError('采样设置保存失败，请重试');
      return false;
    }
  };
  return { policy, supported, error, update };
}
