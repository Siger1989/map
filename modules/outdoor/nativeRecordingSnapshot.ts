import { readRecording, type Recording } from './recording.ts';

/** Native polling must not replace unchanged records and retile their map overlays. */
export function nativeRecordingSnapshot() {
  let previousRaw: string | undefined;
  let previous: Recording | undefined;
  return (raw: string): Recording => {
    if (raw === previousRaw && previous) return previous;
    const parsed = readRecording(raw);
    // Native quality/status fields can change while all recorded fixes stay identical.
    // Retain geometry identity so map overlays and photo matching can reuse their work.
    if (
      previous &&
      parsed.segments.length === previous.segments.length &&
      parsed.segments.every(
        (line, i) =>
          line.length === previous!.segments[i].length &&
          line.every((fix, j) => {
            const old = previous!.segments[i][j];
            return (
              fix.time === old.time &&
              fix.accuracy === old.accuracy &&
              fix.altitude === old.altitude &&
              fix.coordinates[0] === old.coordinates[0] &&
              fix.coordinates[1] === old.coordinates[1]
            );
          }),
      )
    )
      parsed.segments = previous.segments;
    // Only cache successful reads so corrupt/transient payloads remain retryable.
    previousRaw = raw;
    previous = parsed;
    return parsed;
  };
}
