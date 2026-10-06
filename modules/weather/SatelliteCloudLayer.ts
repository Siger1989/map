import type { AddProtocolAction, Map as LibreMap } from 'maplibre-gl';
import type { LayerSettings } from '../map/types';
import { cloudTileBounds, cloudSourceRow, type CloudBounds } from './cloudProjection';
import { listSatelliteCloudFrames, fetchSatelliteCloudImage, type CloudFrame } from './satelliteCloud';

export type SatelliteCloudState = {
  loading: boolean;
  error: string;
  frames: CloudFrame[];
  frame: CloudFrame | null;
  ready: boolean;
};
type ProtocolAPI = {
  addProtocol: (name: string, handler: AddProtocolAction) => void;
  removeProtocol: (name: string) => void;
};
export const CLOUD_LAYER_ID = 'satellite-cloud-observation';
let instance = 0;
const RETRY_DELAY_MS = 5_000;
const MAX_RETRIES = 2;

async function mercatorCloud(blob: Blob, sourceBounds: CloudBounds, bounds: CloudBounds, signal: AbortSignal): Promise<ArrayBuffer> {
  const bitmap = await createImageBitmap(blob);
  try {
    signal.throwIfAborted();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前设备无法绘制云图');
    for (let row = 0; row < 256; row++) {
      const sourceRow = cloudSourceRow(bounds, row, 256, bitmap.height, sourceBounds);
      const left = (bounds[0] - sourceBounds[0]) / (sourceBounds[2] - sourceBounds[0]) * bitmap.width;
      const width = (bounds[2] - bounds[0]) / (sourceBounds[2] - sourceBounds[0]) * bitmap.width;
      context.drawImage(bitmap, left, sourceRow, width, 1, 0, row, 256, 1);
    }
    // The validated global frame can have fully transparent local tiles.
    const projected = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('云图投影失败')), 'image/png'));
    signal.throwIfAborted();
    return projected.arrayBuffer();
  } finally { bitmap.close(); }
}

/** Independent observation raster. Never changes the camera or replaces the basemap. */
export class SatelliteCloudLayer {
  private readonly scheme = `shantu-cloud-${++instance}`;
  private readonly source = `${CLOUD_LAYER_ID}-source`;
  private state: SatelliteCloudState = { loading: false, error: '', frames: [], frame: null, ready: false };
  private settings: LayerSettings | null = null;
  private metadataAbort: AbortController | null = null;
  private requests = new Set<AbortController>();
  private closed = false;
  private refreshTimer: ReturnType<typeof setInterval>;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryKind: 'metadata' | 'frame' | null = null;
  private pendingMetadataRetry = false;
  private pendingFrameRetry: CloudFrame | null = null;
  private metadataRetries = 0;
  private retryFrameStamp = '';
  private frameRetries = 0;
  private failedFrameStamp = '';
  private readonly retryDelayMs: number;
  constructor(private map: LibreMap, private api: ProtocolAPI, private onState: (state: SatelliteCloudState) => void, options: { retryDelayMs?: number } = {}) {
    this.retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
    api.addProtocol(this.scheme, this.protocol);
    this.refreshTimer = setInterval(() => {
      if (this.settings?.clouds && !document.hidden) void this.loadFrames();
    }, 10 * 60 * 1000);
  }
  private publish(patch: Partial<SatelliteCloudState>) {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.onState(this.state);
  }
  private protocol: AddProtocolAction = async (request, controller) => {
    const match = request.url.match(/:\/\/(\d{12})\/(\d+)\/(\d+)\/(\d+)/);
    if (!match || this.closed || !this.settings?.clouds) throw new Error('云图请求已取消');
    const frame = this.state.frames.find(item => item.stamp === match[1]);
    if (!frame) throw new Error('该时次云图已过期，请切回最新');
    const bounds = cloudTileBounds(Number(match[2]), Number(match[3]), Number(match[4]));
    this.requests.add(controller);
    try {
      const image = await fetchSatelliteCloudImage(frame, bounds, controller.signal);
      const data = await mercatorCloud(image.blob, image.bounds, bounds, controller.signal);
      controller.signal.throwIfAborted();
      if (this.state.frame?.stamp === frame.stamp) {
        this.failedFrameStamp = '';
        this.cancelRetryKind('frame');
        this.publish({ ready: true, loading: false, error: '' });
      }
      return { data };
    } catch (error) {
      if (!controller.signal.aborted && !this.closed && this.settings?.clouds && this.state.frame?.stamp === frame.stamp) {
        this.failedFrameStamp = frame.stamp;
        this.publish({ loading: false, error: error instanceof Error ? error.message : '卫星云图暂不可用' });
        this.scheduleFrameRetry(frame);
      }
      throw error;
    } finally { this.requests.delete(controller); }
  };
  update(settings: LayerSettings) {
    const wasEnabled = this.settings?.clouds;
    const changedTime = this.settings?.cloudTime !== settings.cloudTime;
    this.settings = settings;
    if (!settings.clouds) {
      this.cancelRetry();
      this.metadataRetries = 0;
      this.retryFrameStamp = '';
      this.frameRetries = 0;
      this.failedFrameStamp = '';
      this.metadataAbort?.abort();
      for (const request of this.requests) request.abort();
      this.clear();
      if (wasEnabled) this.publish({ loading: false, ready: false, error: '' });
      return;
    }
    if (!wasEnabled) { void this.loadFrames(); return; }
    if (changedTime) {
      this.cancelRetry();
      this.selectFrame();
    }
    if (this.map.getLayer(CLOUD_LAYER_ID)) this.map.setPaintProperty(CLOUD_LAYER_ID, 'raster-opacity', settings.cloudOpacity ?? 0.55);
  }
  private async loadFrames(retry = false) {
    this.cancelRetryKind('metadata');
    if (!retry) this.metadataRetries = 0;
    this.metadataAbort?.abort();
    const controller = new AbortController();
    this.metadataAbort = controller;
    this.publish({ loading: true, error: '' });
    try {
      const frames = await listSatelliteCloudFrames(controller.signal);
      controller.signal.throwIfAborted();
      if (!this.settings?.clouds || this.closed) return;
      this.metadataRetries = 0;
      this.cancelRetryKind('metadata');
      this.publish({ frames });
      this.selectFrame();
    } catch (error) {
      if (!controller.signal.aborted) {
        this.publish({ loading: false, error: error instanceof Error ? error.message : '卫星云图暂不可用' });
        this.scheduleMetadataRetry();
      }
    }
  }
  private selectFrame() {
    const frames = this.state.frames;
    const frame = this.settings?.cloudTime ? frames.find(item => item.stamp === this.settings!.cloudTime) : frames.at(-1);
    if (!frame) {
      this.cancelRetry();
      this.retryFrameStamp = '';
      this.frameRetries = 0;
      this.failedFrameStamp = '';
      this.clear();
      this.publish({ frame: null, ready: false, loading: false, error: this.settings?.cloudTime ? '该时次已过期，请切回最新' : '暂无可用卫星云图' });
      return;
    }
    if (frame.stamp === this.state.frame?.stamp && this.map.getSource(this.source)) {
      if (this.failedFrameStamp === frame.stamp || (this.state.error && !this.state.ready)) {
        this.failedFrameStamp = frame.stamp;
        this.scheduleFrameRetry(frame);
      } else if (this.state.ready) {
        this.publish({ loading: false, error: '' });
      }
      return;
    }
    this.cancelRetry();
    this.retryFrameStamp = frame.stamp;
    this.frameRetries = 0;
    this.failedFrameStamp = '';
    this.createFrameSource(frame);
  }
  private createFrameSource(frame: CloudFrame) {
    for (const request of this.requests) request.abort();
    this.clear();
    this.publish({ frame, ready: false, loading: true, error: '' });
    this.map.addSource(this.source, {
      type: 'raster', tileSize: 256, minzoom: 0, maxzoom: 5,
      tiles: [`${this.scheme}://${frame.stamp}/{z}/{x}/{y}.png`],
      attribution: '<a href="https://www.nsmc.org.cn/" target="_blank">国家卫星气象中心 · 全球静止卫星红外云图</a>',
    });
    const before = this.map.getStyle().layers.find(layer => layer.type === 'symbol' || /^(rivers|road-|open-roads|domestic-labels|domestic-boundaries|route-|track-|annotation-|position-|guidance-)/.test(layer.id))?.id;
    this.map.addLayer({ id: CLOUD_LAYER_ID, type: 'raster', source: this.source,
      paint: { 'raster-opacity': this.settings?.cloudOpacity ?? 0.55, 'raster-fade-duration': 0 } }, before);
  }
  private cancelRetry() {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryKind = null;
    this.pendingMetadataRetry = false;
    this.pendingFrameRetry = null;
  }
  private cancelRetryKind(kind: 'metadata' | 'frame') {
    if (this.retryKind === kind) {
      if (this.retryTimer !== null) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.retryKind = null;
    }
    if (kind === 'metadata') this.pendingMetadataRetry = false;
    else this.pendingFrameRetry = null;
    this.startRetryTimer();
  }
  private scheduleMetadataRetry() {
    if (this.closed || !this.settings?.clouds || this.metadataRetries >= MAX_RETRIES ||
        this.retryKind === 'metadata' || this.pendingMetadataRetry) return;
    this.pendingMetadataRetry = true;
    this.startRetryTimer();
  }
  private scheduleFrameRetry(frame: CloudFrame) {
    if (this.closed || !this.settings?.clouds || this.state.frame?.stamp !== frame.stamp ||
        this.retryFrameStamp !== frame.stamp || this.frameRetries >= MAX_RETRIES ||
        (this.retryKind === 'frame' && this.retryFrameStamp === frame.stamp) ||
        this.pendingFrameRetry?.stamp === frame.stamp) return;
    this.pendingFrameRetry = frame;
    this.startRetryTimer();
  }
  private startRetryTimer() {
    if (this.retryTimer !== null || this.closed || !this.settings?.clouds) return;
    const frame = this.pendingFrameRetry;
    const kind: 'metadata' | 'frame' | null = frame ? 'frame' : this.pendingMetadataRetry ? 'metadata' : null;
    if (!kind) return;
    if (kind === 'frame') this.pendingFrameRetry = null;
    else this.pendingMetadataRetry = false;
    this.retryKind = kind;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryKind = null;
      if (kind === 'metadata') {
        if (!this.closed && this.settings?.clouds && this.metadataRetries < MAX_RETRIES) {
          this.metadataRetries++;
          void this.loadFrames(true);
        }
      } else if (frame && !this.closed && this.settings?.clouds && this.state.frame?.stamp === frame.stamp &&
          this.failedFrameStamp === frame.stamp && this.frameRetries < MAX_RETRIES) {
        this.frameRetries++;
        this.createFrameSource(frame);
      }
      this.startRetryTimer();
    }, this.retryDelayMs);
  }
  private clear() {
    if (this.map.getLayer(CLOUD_LAYER_ID)) this.map.removeLayer(CLOUD_LAYER_ID);
    if (this.map.getSource(this.source)) this.map.removeSource(this.source);
  }
  dispose() {
    this.closed = true;
    this.cancelRetry();
    clearInterval(this.refreshTimer);
    this.metadataAbort?.abort();
    for (const request of this.requests) request.abort();
    this.clear();
    this.api.removeProtocol(this.scheme);
  }
}
