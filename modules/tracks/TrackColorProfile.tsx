import { useEffect, useMemo, useState } from 'react';
import type { ManualTrack } from './drawing';
import type { Coordinate } from '../navigation/types';
import { sampleTerrain, type ElevationSample } from '../journey/metrics';
import { readProfile } from '../journey/elevationProvider';
import { ColorElevation } from './ColorElevation';

export function TrackColorProfile({
  track,
  lines,
  onCondition,
}: {
  track: ManualTrack;
  lines: Coordinate[][];
  onCondition?: (color: string, value: string) => boolean;
}) {
  const key = JSON.stringify(lines);
  const points = useMemo(() => sampleTerrain(JSON.parse(key)), [key]);
  const [result, setResult] = useState<{
      points: typeof points;
      samples: ElevationSample[];
    } | null>(null),
    [loading, setLoading] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    setLoading(true);
    void readProfile(points, request.signal)
      .then((samples) => {
        if (!request.signal.aborted) setResult({ points, samples });
      })
      .catch(() => {
        if (!request.signal.aborted) setResult({ points, samples: [] });
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [points, retry]);
  return (
    <>
      <ColorElevation
        track={track}
        lines={lines}
        samples={result?.points === points ? result.samples : []}
        onCondition={onCondition}
      />
      {loading ? (
        <p role="status">正在读取分段海拔…</p>
      ) : (
        <button onClick={() => setRetry((n) => n + 1)}>刷新海拔</button>
      )}
    </>
  );
}
