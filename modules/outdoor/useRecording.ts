import { useEffect, useMemo, useRef, useState } from 'react';
import { finishRecording } from './finishRecording';
import { saveRecording } from './savedRecording';
import { useRecordingStyle } from './useRecordingStyle';
import { useSamplingPolicy } from './useSamplingPolicy';
import { useRecordingPreferences } from './useRecordingPreferences';
import { recordingAccuracyMessage } from './recordingPreferences';
import { nativeRecordingSnapshot } from './nativeRecordingSnapshot';
import { macBridge, macRequest, readMacRecordingConfig, subscribeMacState } from '../platform/macNative';
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
      photoFolders?(): boolean;
      photoOutput?(name: string, base64: string, share: boolean): string;
      routeOutput?(name: string, base64: string, share: boolean): string;
      archiveBegin?(name: string, size: number): string;
      archiveAppend?(token: string, offset: number, base64: string): string;
      archiveFinish?(token: string, share: boolean): string;
      archiveCancel?(token: string): void;
      routeLinkShare?(url: string): string;
      placeTextShare?(text: string): string;
      recordingAccuracy?(): number;
      setRecordingAccuracy?(metres: number): boolean;
      recordingSampling?(): string;
      setRecordingSampling?(json: string): boolean;
      locate?(mode: string): void;
      locationState?(): string;
      stopLocation?(): void;
      setKeepScreenOn?(enabled: boolean): void;
      compassEnabled?(enabled: boolean): void;
      compassState?(): string;
      motionState?(): string;
      motionEnabled?(enabled: boolean): void;
    };
  }
}
export function useRecording() {
  const [record, setRecord] = useState<Recording>(emptyRecording);
  const [native, setNative] = useState(() => typeof window !== 'undefined' && (!!window.GuanyunNative || !!macBridge()));
  const preferences = useRecordingPreferences();
  const appearance = useRecordingStyle();
  const sampling = useSamplingPolicy();
  const policy = useRef(sampling.policy);
  policy.current = sampling.policy;
  const maximum = useRef(preferences.maximum);
  maximum.current = preferences.maximum;
  const [qualityNote, setQualityNote] = useState('');
  const [finishing,setFinishing]=useState(false);
  const finishingRef=useRef(false);
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
    if (macBridge()) {
      setNative(true);
      const snapshot = nativeRecordingSnapshot();
      const consume = (raw: unknown) => {
        if (raw === undefined || raw === null || raw === '') return;
        try {
          const serialized = typeof raw === 'string' ? raw : JSON.stringify(raw);
          const parsed = JSON.parse(serialized);
          if (!parsed || !['idle', 'recording', 'paused', 'finished'].includes(parsed.phase) ||
              typeof parsed.id !== 'string' || !Array.isArray(parsed.segments)) return;
          const next = snapshot(serialized);
          current.current = next;
          setRecord(next);
          nativeCommand.current = null;
        } catch {
          setRecord(r => r.error === '原生记录暂时无法读取'
            ? r : { ...r, error: 'macOS 记录暂时无法读取；原数据已保留' });
        }
      };
      const unsubscribe = subscribeMacState(state => consume(state.recording));
      void macRequest('record.state').then(consume).catch(() => {
        setRecord(r => ({ ...r, error: '正在连接 macOS 记录服务；现有记录保持不变' }));
      });
      return unsubscribe;
    }
    const bridge = window.GuanyunNative;
    setNative(!!bridge);
    if (bridge) {
      const snapshot = nativeRecordingSnapshot();
      const read = () => {
        try {
          setRecord(snapshot(bridge.recordState()));
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
    if(finishingRef.current)return;
    setQualityNote('');
    if (macBridge()) {
      if ((action === 'start' || action === 'resume') &&
          (!preferences.supported || !sampling.supported || preferences.pending || sampling.pending)) {
        setRecord(r => ({ ...r, error: '正在读取 macOS 已保存的记录配置，请稍后重试' }));
        return;
      }
      if (nativeCommand.current === action) return;
      nativeCommand.current = action;
      void (async () => {
        const config = action === 'start' || action === 'resume'
          ? await readMacRecordingConfig()
          : null;
        const raw = await macRequest('record.command', {
          command: action,
          ...(config ? { maximumAccuracy: config.maximumAccuracy, sampling: config.sampling } : {}),
        });
        if (raw !== undefined && raw !== null) {
          const next = readRecording(typeof raw === 'string' ? raw : JSON.stringify(raw));
          current.current = next; setRecord(next); nativeCommand.current = null;
        } else {
          const state = await macRequest('record.state');
          if (state !== undefined && state !== null) {
            const next = readRecording(typeof state === 'string' ? state : JSON.stringify(state));
            current.current = next; setRecord(next);
          }
          nativeCommand.current = null;
        }
      })().catch(error => {
        nativeCommand.current = null;
        setRecord(r => ({ ...r, error: error instanceof Error ? error.message : 'macOS 记录命令失败' }));
      });
      return;
    }
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
        });
    } catch (e) {
      setRecord((r) => ({ ...r, error: (e as Error).message }));
    }
  };
  const finish = async (keep:boolean, onTrackRemapped?: (from: string, to: string) => Promise<void>) => {
    if(finishingRef.current)return null;
    finishingRef.current=true;setFinishing(true);setQualityNote('');
    const bridge=window.GuanyunNative;
    const mac=macBridge();
    const read=()=>bridge ? readRecording(bridge.recordState()) : current.current;
    const send=async (action:'finish'|'clear')=> {
      if(bridge)bridge.record(action);
      else if(mac) {
        const raw = await macRequest('record.command', { command: action });
        const state = raw ?? await macRequest('record.state');
        if(state===undefined||state===null)throw Error('macOS 未确认记录状态');
        const next=readRecording(typeof state==='string'?state:JSON.stringify(state));
        current.current=next;setRecord(next);
      }
      else {
        if(!writable.current)throw Error('记录存储不可写，原数据已保留');
        const next=action==='clear' ? emptyRecording() : {...current.current,phase:'finished' as const};
        localStorage.setItem(RECORDING_KEY,JSON.stringify(next));
        if(localStorage.getItem(RECORDING_KEY)!==JSON.stringify(next))throw Error('记录状态保存失败，请重试');
        current.current=next;setRecord(next);
      }
    };
    try {
      return await finishRecording({keep,read,send,save:async r=>{
        const id=saveRecording({...r,style:appearance.style}).id;
        if(id!==r.id) await onTrackRemapped?.(r.id,id);
        return id;
      }});
    } finally {
      try {const next=read();current.current=next;setRecord(next);}catch{}
      finishingRef.current=false;setFinishing(false);
    }
  };
  const styledRecord = useMemo(
    () => ({ ...record, style: appearance.style }),
    [record, appearance.style],
  );
  return {
    record: styledRecord,
    native,
    command,
    finish,
    finishing,
    preferences,
    qualityNote,
    appearance,
    sampling,
  };
}
