import { ArrayBufferTarget, Muxer } from 'webm-muxer';
import type { SkyJourneyRecording } from './journeyRecorder';

/** Frame-driven software-capable encoding avoids compositor capture timing. */
export function startJourneyVideoEncoder(
  canvas: HTMLCanvasElement,
  fps: number,
  limit: number,
  maxBytes: number,
  signal?: AbortSignal,
): SkyJourneyRecording | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  const width = canvas.width;
  const height = canvas.height;
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'V_VP8', width, height, frameRate: fps },
    firstTimestampBehavior: 'offset',
  });
  const frameDuration = Math.round(1_000_000 / fps);
  const begun = performance.now();
  let pausedAt: number | null = null;
  let pausedMs = 0;
  let previous = -1;
  let frames = 0;
  let lastKeyFrame = -2_000_000;
  let bytes = 0;
  let packets = 0;
  let finishing = false;
  let ended = false;
  let deadline: ReturnType<typeof setTimeout>;
  let resolve: (blob: Blob) => void;
  let reject: (error: unknown) => void;
  const result = new Promise<Blob>((ok, fail) => { resolve = ok; reject = fail; });
  void result.catch(() => {});
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      if (ended) return;
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        fail(new Error('录像超过 64 MB，请缩短回放'));
        return;
      }
      try { muxer.addVideoChunk(chunk, metadata); packets++; }
      catch (error) { fail(error); }
    },
    error(error) { fail(error); },
  });
  try {
    encoder.configure({ codec: 'vp8', width, height, bitrate: 2_500_000, framerate: fps, latencyMode: 'realtime' });
  } catch {
    if (encoder.state !== 'closed') encoder.close();
    return null;
  }

  function clean() {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', cancel);
    if (encoder.state !== 'closed') encoder.close();
  }
  function fail(error: unknown) {
    if (ended) return;
    ended = true;
    clean();
    reject(error);
  }
  function cancel() { fail(signal?.aborted ? signal.reason : new DOMException('录像已取消', 'AbortError')); }
  const pause = () => { if (!ended && pausedAt === null) pausedAt = performance.now(); };
  const resume = () => {
    if (pausedAt === null) return;
    pausedMs += performance.now() - pausedAt;
    pausedAt = null;
  };
  function requestFrame(force = false, timeUs?: number) {
    if (ended || finishing || pausedAt !== null || encoder.encodeQueueSize >= 6) return false;
    const timestamp = timeUs === undefined
      ? previous < 0 ? 0 : Math.max(previous + 1, Math.round((performance.now() - begun - pausedMs) * 1_000))
      : Math.round(timeUs);
    if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp <= previous) return false;
    if (timestamp > 120_000_000 || frames >= Math.ceil(120 * fps) + 1) {
      fail(new Error('录像超过成片时长或帧数上限'));
      return false;
    }
    if (!force && timeUs === undefined && previous >= 0 && timestamp - previous < frameDuration) return false;
    let frame: VideoFrame | undefined;
    try {
      frame = new VideoFrame(canvas, { timestamp, duration: frameDuration });
      const keyFrame = timestamp - lastKeyFrame >= 2_000_000;
      encoder.encode(frame, { keyFrame });
      if (keyFrame) lastKeyFrame = timestamp;
      previous = timestamp;
      frames++;
      return true;
    } catch (error) { fail(error); return false; }
    finally { frame?.close(); }
  }
  const stop = () => {
    if (ended || finishing) return result;
    finishing = true;
    clearTimeout(deadline);
    deadline = setTimeout(() => fail(new Error('录像编码结束超时')), 8_000);
    void encoder.flush().then(() => {
      if (ended) return;
      if (!packets) { fail(new Error('录像没有可保存的画面')); return; }
      muxer.finalize();
      if (target.buffer.byteLength > maxBytes) { fail(new Error('录像超过 64 MB，请缩短回放')); return; }
      const blob = new Blob([target.buffer], { type: 'video/webm' });
      ended = true;
      clean();
      resolve(blob);
    }).catch(fail);
    return result;
  };
  deadline = setTimeout(() => fail(new Error('录像超时，回放尚未录完')), limit);
  signal?.addEventListener('abort', cancel, { once: true });
  return { mimeType: 'video/webm', timedFrames: true, requestFrame, pause, resume, stop, cancel };
}
