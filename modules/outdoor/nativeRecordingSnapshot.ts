import { readRecording, type Recording } from './recording.ts';

/** Native polling must not replace unchanged records and retile their map overlays. */
export function nativeRecordingSnapshot() {
  let previousRaw: string | undefined;
  let previous: Recording | undefined;
  return (raw: string): Recording => {
    if (raw === previousRaw && previous) return previous;
    const parsed = readRecording(raw);
    // Only cache successful reads so corrupt/transient payloads remain retryable.
    previousRaw = raw;
    previous = parsed;
    return parsed;
  };
}
