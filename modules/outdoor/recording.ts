import {
  coordinate,
  metresBetween,
  type Coordinate,
} from '../navigation/types.ts';
export type Fix = {
  coordinates: Coordinate;
  time: number;
  accuracy: number;
  altitude: number | null;
};
export type Recording = {
  id: string;
  phase: 'idle' | 'recording' | 'paused' | 'finished';
  startedAt: number;
  segments: Fix[][];
  error: string;
};
export const RECORDING_KEY = 'guanyun.recording.v1';
export const emptyRecording = (): Recording => ({
  id: '',
  phase: 'idle',
  startedAt: 0,
  segments: [],
  error: '',
});
export function validFix(f: Fix) {
  return (
    !!f &&
    coordinate(f.coordinates) &&
    Number.isFinite(f.time) &&
    Number.isFinite(f.accuracy) &&
    f.accuracy >= 0 &&
    f.accuracy <= 80 &&
    (f.altitude === null || Number.isFinite(f.altitude))
  );
}
export function readRecording(raw: string | null): Recording {
  if (!raw) return emptyRecording();
  const v = JSON.parse(raw) as Recording;
  if (
    !v ||
    typeof v.id !== 'string' ||
    !['idle', 'recording', 'paused', 'finished'].includes(v.phase) ||
    !Number.isFinite(v.startedAt) ||
    !Array.isArray(v.segments) ||
    v.segments.length > 100 ||
    !v.segments.every((s) => Array.isArray(s) && s.every(validFix)) ||
    v.segments.flat().length > 6000
  )
    throw new Error('记录存档损坏，请先导出备份');
  return v;
}
/** Reject stale, inaccurate and implausible fixes; keep pauses as separate segments. */
export function appendFix(
  record: Recording,
  fix: Fix,
  now = Date.now(),
): Recording {
  if (
    record.phase !== 'recording' ||
    !validFix(fix) ||
    now - fix.time > 20000 ||
    fix.time > now + 5000
  )
    return record;
  if (record.segments.flat().length >= 6000)
    return {
      ...record,
      phase: 'paused',
      error: '已达 6000 点，请结束保存后开始新记录',
    };
  const segments = record.segments.map((s) => [...s]);
  if (!segments.length) segments.push([]);
  let line = segments[segments.length - 1];
  const last = line.at(-1);
  if (last) {
    const seconds = (fix.time - last.time) / 1000,
      distance = metresBetween(last.coordinates, fix.coordinates);
    if (
      seconds <= 0 ||
      distance / seconds > 80 ||
      (distance < 5 && seconds < 30)
    )
      return record;
    if (seconds > 120) {
      if (segments.length >= 100)
        return {
          ...record,
          phase: 'paused',
          error: '记录分段已达上限，请结束保存',
        };
      line = [];
      segments.push(line);
    }
  }
  line.push(fix);
  return { ...record, segments, error: '' };
}
export function resumeRecording(record: Recording): Recording {
  if (record.segments.length >= 100)
    throw new Error('分段已达上限，请结束保存');
  return {
    ...record,
    phase: 'recording',
    error: '',
    segments: [...record.segments.filter((s) => s.length), []],
  };
}
