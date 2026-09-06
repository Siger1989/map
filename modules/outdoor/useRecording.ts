import { useEffect, useRef, useState } from 'react';
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
      saveFile(name: string, mime: string, text: string): void;
    };
  }
}
export function useRecording() {
  const [record, setRecord] = useState<Recording>(emptyRecording);
  const [native, setNative] = useState(false);
  const current = useRef(record);
  current.current = record;
  const writable = useRef(true);
  const persist = (next: Recording) => {
    if (!writable.current) return;
    try {
      localStorage.setItem(RECORDING_KEY, JSON.stringify(next));
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
      const read = () => {
        try {
          setRecord(readRecording(bridge.recordState()));
        } catch {
          setRecord((r) => ({ ...r, error: '原生记录暂时无法读取' }));
        }
      };
      read();
      const timer = window.setInterval(read, 1500);
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
      (p) =>
        persist(
          appendFix(current.current, {
            coordinates: [p.coords.longitude, p.coords.latitude],
            accuracy: p.coords.accuracy,
            altitude: p.coords.altitude,
            time: p.timestamp,
          }),
        ),
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
    if (window.GuanyunNative) {
      window.GuanyunNative.record(action);
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
        });
    } catch (e) {
      setRecord((r) => ({ ...r, error: (e as Error).message }));
    }
  };
  return { record, native, command };
}
