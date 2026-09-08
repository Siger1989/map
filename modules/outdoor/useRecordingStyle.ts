import { useEffect, useState } from 'react';
import {
  DEFAULT_TRACK_STYLE,
  normalizeTrackStyle,
  type TrackStyle,
} from '../tracks/style';

// Kept outside native GPS snapshots so polling cannot reset the chosen appearance.
const STORAGE_KEY = 'guanyun.recording-style.v1';
export function useRecordingStyle() {
  const [style, setStyle] = useState(DEFAULT_TRACK_STYLE);
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      setStyle(
        normalizeTrackStyle(
          JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'),
        ),
      );
    } catch {
      setError('轨迹样式未能读取，请重新选择');
    }
  }, []);
  const update = (value: TrackStyle) => {
    const next = normalizeTrackStyle(value);
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
