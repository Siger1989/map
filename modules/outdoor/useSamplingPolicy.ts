import { useEffect, useState } from 'react';
import {
  DEFAULT_SAMPLING,
  SAMPLING_KEY,
  validSampling,
  type SamplingPolicy,
} from './samplingPolicy';
import { configureMacRecording, macBridge, readMacRecordingConfig } from '../platform/macNative';

export function useSamplingPolicy() {
  const [policy, setPolicy] = useState(DEFAULT_SAMPLING);
  const [supported, setSupported] = useState(false),
    [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (macBridge()) {
      let active = true;
      void readMacRecordingConfig().then(config => {
        if (!active) return;
        if (!validSampling(config.sampling)) throw Error('macOS 采样配置无效');
        setPolicy(config.sampling as unknown as SamplingPolicy);
        setSupported(true); setError('');
      }).catch(e => {
        if (active) { setSupported(false); setError(e instanceof Error ? e.message : 'macOS 记录配置暂不可用'); }
      });
      return () => { active = false; };
    }
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
  const update = async (next: SamplingPolicy) => {
    if (macBridge()) {
      if (!validSampling(next)) { setError('采样参数无效'); return false; }
      setPending(true); setError('正在保存 macOS 采样设置…');
      try {
        const config = await configureMacRecording({ sampling: next });
        if (!validSampling(config.sampling)) throw Error('macOS 返回的采样配置无效');
        setPolicy(config.sampling as unknown as SamplingPolicy); setError(''); return true;
      } catch (e) { setError(e instanceof Error ? e.message : 'macOS 设置保存失败'); return false; }
      finally { setPending(false); }
    }
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
  return { policy, supported, error, pending, update };
}
