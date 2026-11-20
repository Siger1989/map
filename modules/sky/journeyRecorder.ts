import { deliverFile } from '../files/delivery';
import { startJourneyVideoEncoder } from './journeyVideoEncoder';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_DURATION = 120_000;
const MAX_TIMED_ENCODING_DURATION = 15 * 60_000;
const TIMESLICE = 500;
const VIDEO_TYPES = [
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
  'video/webm',
  'video/mp4',
];

interface RecordingOptions {
  frameRate?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
}

export interface SkyJourneyRecording {
  readonly mimeType: string;
  readonly timedFrames: boolean;
  requestFrame(force?: boolean, timeUs?: number): boolean;
  pause(): void;
  resume(): void;
  stop(): Promise<Blob>;
  cancel(): void;
}

export function skyJourneyRecordingSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' || canUseMediaRecorder();
}

function canUseMediaRecorder(): boolean {
  return typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof MediaRecorder.isTypeSupported === 'function' &&
    VIDEO_TYPES.some(type => MediaRecorder.isTypeSupported(type));
}

function makeRecorder(stream: MediaStream): MediaRecorder {
  for (const mimeType of VIDEO_TYPES) {
    if (!MediaRecorder.isTypeSupported(mimeType)) continue;
    try { return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 3_000_000 }); }
    catch { /* Check the next format actually supported by this device. */ }
  }
  throw new Error('当前设备无法编码 MP4 或 WebM 视频');
}

export function startSkyJourneyRecording(
  canvas: HTMLCanvasElement,
  { frameRate = 24, maxDurationMs = MAX_DURATION, signal }: RecordingOptions = {},
): SkyJourneyRecording {
  signal?.throwIfAborted();
  if (!skyJourneyRecordingSupported()) throw new Error('当前浏览器或 WebView 不支持录像');
  if (!canvas.width || !canvas.height || canvas.width * canvas.height > 3840 * 2160)
    throw new Error('录像画布尺寸无效');
  const fps = Number.isFinite(frameRate) ? Math.max(1, Math.min(30, frameRate)) : 24;
  const requestedLimit = Number.isFinite(maxDurationMs) ? Math.max(TIMESLICE, maxDurationMs) : MAX_DURATION;
  const limit = Math.min(MAX_DURATION, requestedLimit);
  const encoder = startJourneyVideoEncoder(canvas, fps, Math.min(MAX_TIMED_ENCODING_DURATION, requestedLimit), MAX_BYTES, signal);
  if (encoder) return encoder;
  if (!canUseMediaRecorder()) throw new Error('当前设备无法编码视频');
  const stream = canvas.captureStream(fps);
  const captureTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  const stopTracks = () => stream.getTracks().forEach(track => track.stop());
  let recorder: MediaRecorder;
  try { recorder = makeRecorder(stream); }
  catch (error) { stopTracks(); throw error; }

  let resolve: (blob: Blob) => void;
  let reject: (error: unknown) => void;
  const result = new Promise<Blob>((ok, failed) => { resolve = ok; reject = failed; });
  void result.catch(() => {});
  let timer: ReturnType<typeof setTimeout>;
  let stopTimer: ReturnType<typeof setTimeout>;
  let settled = false;
  let size = 0;
  const parts: Blob[] = [];
  const cleanup = () => {
    clearTimeout(timer);
    clearTimeout(stopTimer);
    signal?.removeEventListener('abort', cancel);
    recorder.ondataavailable = null;
    recorder.onerror = null;
    recorder.onstop = null;
    parts.length = 0;
    stopTracks();
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    if (recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* Cleanup also stops every capture track. */ }
    }
    cleanup();
    reject(error);
  };
  function cancel() {
    fail(signal?.aborted ? signal.reason : new DOMException('录像已取消', 'AbortError'));
  }
  const stop = () => {
    clearTimeout(timer);
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
        stopTimer = setTimeout(() => fail(new Error('录像编码结束超时')), 8_000);
      } catch (error) { fail(error); }
    }
    return result;
  };
  recorder.ondataavailable = ({ data }) => {
    if (!data.size || settled) return;
    size += data.size;
    if (size > MAX_BYTES) {
      fail(new Error('录像超过 64 MB，请缩短回放'));
      return;
    }
    parts.push(data);
  };
  recorder.onerror = () => fail(new Error('录像编码失败'));
  recorder.onstop = () => {
    if (settled) return;
    if (!size) { fail(new Error('录像没有可保存的画面')); return; }
    const blob = new Blob(parts, { type: recorder.mimeType || parts[0].type });
    settled = true;
    cleanup();
    resolve(blob);
  };
  try { recorder.start(TIMESLICE); }
  catch (error) { cleanup(); throw error; }
  timer = setTimeout(() => fail(new Error('录像超时，回放尚未录完')), limit);
  signal?.addEventListener('abort', cancel, { once: true });
  const pause = () => { if (recorder.state === 'recording') recorder.pause(); };
  const resume = () => { if (recorder.state === 'paused') recorder.resume(); };
  const requestFrame = () => {
    if (recorder.state !== 'recording') return false;
    captureTrack?.requestFrame?.();
    return true;
  };
  return { mimeType: recorder.mimeType, timedFrames: false, requestFrame, pause, resume, stop, cancel };
}

export async function saveSkyJourneyRecording(blob: Blob, signal?: AbortSignal): Promise<void> {
  const mimeType = blob.type.split(';')[0];
  if (mimeType !== 'video/mp4' && mimeType !== 'video/webm') throw new Error('录像格式无效');
  if (blob.size <= 0 || blob.size > MAX_BYTES) throw new Error('录像文件大小无效');
  const extension = mimeType.split('/')[1];
  await deliverFile(new File([blob], `Shantu-sky-journey-${Date.now()}.${extension}`, { type: mimeType }), false, signal);
}
