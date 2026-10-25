export type ShantuMacSnapshot = {
  location?: unknown;
  recording?: unknown;
  offline?: unknown;
};

export type ShantuMacBridge = {
  version: number;
  snapshot?: ShantuMacSnapshot;
  request(action: string, args?: Record<string, unknown>): Promise<unknown>;
};

declare global {
  interface Window {
    ShantuMac?: ShantuMacBridge;
  }
}

const MAX_FILE_BYTES = 100 * 1024 * 1024;
const FILE_CHUNK_BYTES = 256 * 1024;

export function macBridge(): ShantuMacBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.ShantuMac;
  return bridge && bridge.version === 1 && typeof bridge.request === 'function'
    ? bridge
    : null;
}

export function isMacNativeSupported() {
  return macBridge() !== null;
}

export async function macRequest<T = unknown>(action: string, args?: Record<string, unknown>): Promise<T> {
  const bridge = macBridge();
  if (!bridge) throw new Error('当前应用尚未连接 macOS 系统能力');
  return await bridge.request(action, args) as T;
}

export function macSnapshot<K extends keyof ShantuMacSnapshot>(key: K): ShantuMacSnapshot[K] | undefined {
  return macBridge()?.snapshot?.[key];
}

export function subscribeMacState(listener: (snapshot: ShantuMacSnapshot) => void) {
  if (typeof window === 'undefined') return () => {};
  const update = (event: Event) => {
    const detail = (event as CustomEvent<ShantuMacSnapshot>).detail;
    listener(detail && typeof detail === 'object' ? detail : macBridge()?.snapshot ?? {});
  };
  window.addEventListener('shantu-mac-state', update);
  return () => window.removeEventListener('shantu-mac-state', update);
}

export function macAbortError() {
  return new DOMException('操作已取消', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw macAbortError();
}

async function readBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + step)));
  }
  return btoa(binary);
}

export async function deliverMacFile(file: File, share: boolean, signal?: AbortSignal) {
  throwIfAborted(signal);
  if (!macBridge()) return null;
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 100 MB');
  const token = await macRequest<unknown>('files.begin', { name: file.name, size: file.size });
  if (typeof token !== 'string' || !token) throw new Error('macOS 未能创建文件交付任务');
  let finished = false, cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    void macRequest('files.cancel', { token }).catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (let offset = 0; offset < file.size; offset += FILE_CHUNK_BYTES) {
      throwIfAborted(signal);
      const base64 = await readBase64(file.slice(offset, offset + FILE_CHUNK_BYTES));
      throwIfAborted(signal);
      const received = await macRequest<unknown>('files.append', { token, offset, base64 });
      if (received !== Math.min(file.size, offset + FILE_CHUNK_BYTES))
        throw new Error('macOS 文件接收长度不一致');
    }
    throwIfAborted(signal);
    const result = await macRequest<unknown>('files.finish', { token, share });
    if (result === 'cancelled') throw macAbortError();
    if (result !== (share ? 'shared' : 'saved')) throw new Error('macOS 未确认文件已保存或分享');
    finished = true;
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (!finished) cancel();
  }
}

export async function macShareText(text: string) {
  return await macRequest<'shared' | 'cancelled'>('share.text', { text });
}

export async function macShareUrl(url: string) {
  return await macRequest<'shared' | 'cancelled'>('share.url', { url });
}

export async function macClipboardWrite(text: string) {
  return await macRequest<boolean>('clipboard.write', { text });
}

export async function writeClipboard(text: string) {
  if (isMacNativeSupported()) {
    if (!await macClipboardWrite(text)) throw new Error('macOS 剪贴板写入失败');
    return;
  }
  await navigator.clipboard.writeText(text);
}

export async function macCapturePhoto() {
  const result = await macRequest<unknown>('camera.capture');
  if (result === 'cancelled') throw macAbortError();
  if (!result || typeof result !== 'object') throw new Error('macOS 未返回照片');
  const photo = result as { base64?: unknown; mime?: unknown; name?: unknown };
  if (typeof photo.base64 !== 'string' || photo.mime !== 'image/jpeg')
    throw new Error('macOS 返回的照片格式无效');
  return {
    file: new File([Uint8Array.from(atob(photo.base64), (char) => char.charCodeAt(0))],
      typeof photo.name === 'string' && photo.name ? photo.name : `Shantu-camera-${Date.now()}.jpg`,
      { type: 'image/jpeg' }),
  };
}

function parseMacRecordState(raw: unknown) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object') throw new Error('macOS 记录配置尚未就绪');
  const state = value as { maximumAccuracy?: unknown; sampling?: unknown };
  if (typeof state.maximumAccuracy !== 'number' || !Number.isFinite(state.maximumAccuracy) ||
      !state.sampling || typeof state.sampling !== 'object')
    throw new Error('macOS 未返回已保存的记录配置');
  return state as { maximumAccuracy: number; sampling: Record<string, unknown> };
}

export async function readMacRecordingConfig() {
  return parseMacRecordState(await macRequest('record.state'));
}

let configureQueue: Promise<unknown> = Promise.resolve();
export function configureMacRecording(patch: { maximumAccuracy?: number; sampling?: Record<string, unknown> }) {
  const operation = configureQueue.then(async () => {
  const current = await readMacRecordingConfig();
  const requested = {
    maximumAccuracy: patch.maximumAccuracy ?? current.maximumAccuracy,
    sampling: patch.sampling ?? current.sampling,
  };
  const result = parseMacRecordState(await macRequest('record.configure', requested));
  if (result.maximumAccuracy !== requested.maximumAccuracy ||
      Object.keys(requested.sampling).some(key => result.sampling[key] !== requested.sampling[key]))
    throw new Error('macOS 未确认记录配置已保存');
  return result;
  });
  configureQueue = operation.catch(() => {});
  return operation;
}
