import { useEffect, useMemo, useRef, useState } from 'react';
import { useRecordingStyle } from './useRecordingStyle';
import { useSamplingPolicy } from './useSamplingPolicy';
import { useRecordingPreferences } from './useRecordingPreferences';
import { recordingAccuracyMessage } from './recordingPreferences';
import { nativeRecordingSnapshot } from './nativeRecordingSnapshot';
import {
  awaitRecordingCommand,
  type RecordingAction,
} from './recordingCommand';
import {
  appendFix,
  emptyRecording,
  readRecording,
  RECORDING_KEY,
  resumeRecording,
  type Recording,
} from './recording';
declare global {
  interface Window {
    GuanyunNative?: {
      record(command: string): void;
      recordState(): string;
      recordFor?(command: string, expectedId: string): string;
      saveFile(name: string, mime: string, text: string): void;
      photoFolders?(): boolean;
      photoTimeRange?(start: number, end: number): void;
      photoOutput?(name: string, base64: string, share: boolean): string;
      routeOutput?(name: string, base64: string, share: boolean): string;
      archiveBegin?(name: string, size: number): string;
      archiveAppend?(token: string, offset: number, base64: string): string;
      archiveFinish?(token: string, share: boolean): string;
      archiveCancel?(token: string): void;
      routeLinkShare?(url: string): string;
      recordingAccuracy?(): number;
      setRecordingAccuracy?(metres: number): boolean;
      recordingSampling?(): string;
      setRecordingSampling?(json: string): boolean;
      locate?(mode: string): void;
      locationState?(): string;
      stopLocation?(): void;
    };
  }
}
export function useRecording() {
  const [record, setRecord] = useState<Recording>(emptyRecording);
  const [native, setNative] = useState(false);
  const preferences = useRecordingPreferences();
  const appearance = useRecordingStyle();
  const sampling = useSamplingPolicy();
  const policy = useRef(sampling.policy);
  policy.current = sampling.policy;
  const maximum = useRef(preferences.maximum);
  maximum.current = preferences.maximum;
  const [qualityNote, setQualityNote] = useState('');
  useEffect(() => setQualityNote(''), [preferences.maximum]);
  const current = useRef(record);
  current.current = record;
  const writable = useRef(true);
  const nativeCommand = useRef<string | null>(null);
  const persist = (next: Recording) => {
    if (!writable.current) return;
    try {
      localStorage.setItem(RECORDING_KEY, JSON.stringify(next));
      current.current = next;
      setRecord(next);
    } catch {
      setRecord({
        ...next,
        phase: 'paused',
        error: '存储不足，记录已暂停；请导出当前轨迹',
      });
    }
  };
  useEffect(() => {
    const bridge = window.GuanyunNative;
    setNative(!!bridge);
    if (bridge) {
      const snapshot = nativeRecordingSnapshot();
      const read = () => {
        try {
          const next = snapshot(bridge.recordState());
          current.current = next;
          setRecord(next);
          nativeCommand.current = null;
        } catch {
          nativeCommand.current = null;
          setRecord((r) =>
            r.error === '原生记录暂时无法读取'
              ? r
              : { ...r, error: '原生记录暂时无法读取' },
          );
        }
      };
      read();
      const timer = window.setInterval(() => {
        if (!document.hidden) read();
      }, 1500);
      const wake = () => {
        if (!document.hidden) read();
      };
      document.addEventListener('visibilitychange', wake);
      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', wake);
      };
    }
    try {
      const restored = readRecording(localStorage.getItem(RECORDING_KEY));
      setRecord(
        restored.phase === 'recording'
          ? {
              ...restored,
              phase: 'paused',
              error: '上次记录中断，点击继续恢复',
            }
          : restored,
      );
    } catch {
      writable.current = false;
      setRecord((r) => ({
        ...r,
        error: '记录存档损坏，已保护原数据；请先导出备份',
      }));
    }
  }, []);
  useEffect(() => {
    if (native || record.phase !== 'recording') return;
    if (!navigator.geolocation) {
      persist({
        ...current.current,
        phase: 'paused',
        error: '当前浏览器不支持定位',
      });
      return;
    }
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setQualityNote(
          recordingAccuracyMessage(p.coords.accuracy, maximum.current),
        );
        const next = appendFix(
          current.current,
          {
            coordinates: [p.coords.longitude, p.coords.latitude],
            accuracy: p.coords.accuracy,
            altitude: p.coords.altitude,
            time: p.timestamp,
          },
          Date.now(),
          maximum.current,
          policy.current,
        );
        if (next !== current.current) persist(next);
      },
      (e) =>
        persist({
          ...current.current,
          phase: e.code === 1 ? 'paused' : current.current.phase,
          error:
            e.code === 1 ? '定位权限被拒绝' : '定位信号暂缺；恢复后自动继续',
        }),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    const pause = () => {
      if (document.hidden)
        persist({
          ...current.current,
          phase: 'paused',
          error: '网页版已在切入后台时暂停；安卓安装包支持后台记录',
        });
    };
    document.addEventListener('visibilitychange', pause);
    return () => {
      navigator.geolocation.clearWatch(watch);
      document.removeEventListener('visibilitychange', pause);
    };
  }, [native, record.phase]);
  const command = (
    action: 'start' | 'pause' | 'resume' | 'finish' | 'clear',
  ) => {
    setQualityNote('');
    if (window.GuanyunNative) {
      if (nativeCommand.current === action) return;
      nativeCommand.current = action;
      try {
        window.GuanyunNative.record(action);
      } catch {
        nativeCommand.current = null;
        setRecord((r) => ({ ...r, error: '记录命令未能发送，请重试' }));
      }
      return;
    }
    try {
      if (action === 'start') {
        if (current.current.phase !== 'idle')
          throw new Error('请先保存当前记录');
        persist(
          resumeRecording({
            ...emptyRecording(),
            id: crypto.randomUUID(),
            startedAt: Date.now(),
          }),
        );
      } else if (action === 'resume') persist(resumeRecording(current.current));
      else if (action === 'clear') persist(emptyRecording());
      else
        persist({
          ...current.current,
          phase: action === 'pause' ? 'paused' : 'finished',
          ...(action === 'finish' ? { finishedAt: Date.now() } : {}),
        });
    } catch (e) {
      setRecord((r) => ({ ...r, error: (e as Error).message }));
    }
  };
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const commandAsync = async (
    action: RecordingAction,
    expectedId = current.current.id,
  ) => {
    if (pending.current) throw new Error('正在处理记录，请稍候');
    if (current.current.id !== expectedId)
      throw new Error('记录已切换，请重新打开');
    pending.current = true;
    setBusy(true);
    try {
      let next: Recording;
      if (window.GuanyunNative)
        next = await awaitRecordingCommand(
          action,
          expectedId,
          window.GuanyunNative,
        );
      else {
        command(action);
        next = current.current;
        const wanted = {
          start: 'recording',
          resume: 'recording',
          pause: 'paused',
          finish: 'finished',
          clear: 'idle',
        }[action];
        if (
          next.phase !== wanted ||
          (action !== 'start' && action !== 'clear' && next.id !== expectedId)
        )
          throw new Error(next.error || '记录操作未完成');
      }
      current.current = next;
      setRecord(next);
      return { ...next, style: appearance.style };
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const styledRecord = useMemo(
    () => ({ ...record, style: appearance.style }),
    [record, appearance.style],
  );
  return {
    record: styledRecord,
    native,
    command: (action: RecordingAction) => {
      if (!pending.current) command(action);
    },
    commandAsync,
    busy,
    preferences,
    qualityNote,
    appearance,
    sampling,
  };
}
