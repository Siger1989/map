import type { ManualTrack } from '../tracks/drawing.ts';
import type { Recording } from './recording.ts';
import { collectData, mergeData, type Transfer } from './exchange.ts';
import { normalizeTrackStyle } from '../tracks/style.ts';

/** Coordinates and samples are derived from the same segments, including pause boundaries. */
export function recordingTrack(
  record: Recording,
  includeSinglePoints = false,
): ManualTrack {
  const segments = record.segments.filter(
    (line) => line.length >= (includeSinglePoints ? 1 : 2),
  );
  return {
    id: record.id,
    ...(record.style ? { style: normalizeTrackStyle(record.style) } : {}),
    name: `实走 ${new Date(record.startedAt).toLocaleString('zh-CN')}`,
    source: 'recorded',
    createdAt: record.startedAt,
    segments: segments.map((line) => line.map((p) => [...p.coordinates])),
    samples: segments.map((line) =>
      line.map((p) => ({ time: p.time, altitude: p.altitude })),
    ),
  };
}

export function recordingTransfer(record: Recording): Transfer {
  return {
    format: 'guanyun-backup',
    version: 1,
    tracks: [recordingTrack(record)],
    annotations: [],
    favorites: [],
  };
}

/** The caller may clear the live checkpoint only after a verified persistent save. */
export function saveRecording(
  record: Recording,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
) {
  if (record.phase !== 'finished') throw new Error('请先结束记录再保存');
  const incoming = recordingTransfer(record);
  if (!record.id || !incoming.tracks[0].segments.length)
    throw new Error('尚无可保存的轨迹线段');
  const next = mergeData(incoming, storage);
  const snapshot = (track: ManualTrack) => JSON.stringify({ ...track, id: '' });
  const expected = snapshot(incoming.tracks[0]);
  const saved = next.tracks.find((track) => snapshot(track) === expected);
  if (
    !saved ||
    !collectData(storage).tracks.some(
      (track) => track.id === saved.id && snapshot(track) === expected,
    )
  )
    throw new Error('轨迹保存未确认，实走记录已保留，请重试或导出 GPX');
  return saved;
}
