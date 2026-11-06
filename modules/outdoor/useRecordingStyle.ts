import { useEffect, useState } from 'react';
import {
  DEFAULT_TRACK_STYLE,
  normalizeTrackStyle,
  type TrackStyle,
} from '../tracks/style';

// Kept outside native GPS snapshots so polling cannot reset the chosen appearance.
const STORAGE_KEY = 'guanyun.recording-style.v1';
const DEFAULT_RECORDING_STYLE: TrackStyle = {
  ...DEFAULT_TRACK_STYLE,
  color: '#ffdf4f',
};

function normalizeRecordingStyle(input: unknown): TrackStyle {
  const normalized = normalizeTrackStyle(input);
  if (!input || typeof input !== 'object' ||
      typeof (input as Partial<TrackStyle>).color !== 'string' ||
      !/^#[a-f0-9]{6}$/i.test((input as Partial<TrackStyle>).color ?? '')) {
    return { ...normalized, color: DEFAULT_RECORDING_STYLE.color };
  }
  return normalized;
}

export function useRecordingStyle() {
  const [style, setStyle] = useState(DEFAULT_RECORDING_STYLE);
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      setStyle(
        normalizeRecordingStyle(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')),
      );
    } catch {
      setError('轨迹样式未能读取，请重新选择');
    }
  }, []);
  const update = (value: TrackStyle) => {
    const next = normalizeRecordingStyle(value);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStyle(next);
      setError('');
    } catch {
      setError('轨迹样式保存失败，仍使用原样式');
    }
  };
  return { style, update, error };
}
