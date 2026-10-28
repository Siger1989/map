import { NativeDemCache, projectWgs84, unprojectWgs84 } from './geometry.ts';
import type { Coordinate } from '../../navigation/types.ts';
import type {
  NativeDemTile,
  NativeMapBridgeTransport,
  NativeMapCapability,
  NativeMapCommand,
  NativeMapHello,
  NativeMapHostMessage,
  NativeMapId,
  NativeMapRenderState,
  NativeMapRenderStateAck,
  NativeProjectionFrame,
} from './types.ts';
import { NATIVE_MAP_PROTOCOL_VERSION } from './types.ts';

export type NativeMapEventName =
  | 'cameraFrame' | 'renderFrame' | 'mapReady' | 'mapIdle' | 'tap' | 'longPress' | 'drawingInput'
  | 'pick' | 'mapPick' | 'touch' | 'status' | 'renderStateApplied' | 'renderState' | 'capabilities'
  | 'demCache' | 'viewCreated' | 'mapViewport' | 'camera' | 'capabilityBlocked'
  | 'cachedTileRequest' | 'cachedTileCancel';

export type NativeMapLocalEvent = { name: string; value: unknown };
export type NativeMapEventHandler = (value: unknown, event: NativeMapHostMessage) => void;
export type NativeMapWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'dispatchEvent'> & {
  location: Pick<Location, 'origin'>;
  ShantuNativeMap?: NativeMapBridgeTransport;
};

export class NativeMapBridgeError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'NativeMapBridgeError';
    this.code = code;
    this.details = details;
  }
}

export type NativeMapClientOptions = {
  trustedOrigins: readonly string[];
  window?: NativeMapWindow;
  timeoutMs?: number;
  createRequestId?: () => string;
};
type PendingRequest = {
  mapId: string;
  sessionGeneration: number;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abort?: () => void;
};

/** Versioned JSON bridge client shared by primary and comparison maps in one WebView. */
export class NativeMapBridgeClient {
  private readonly win: NativeMapWindow;
  private readonly transport: NativeMapBridgeTransport;
  private readonly timeoutMs: number;
  private readonly makeRequestId: () => string;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Map<string, Set<NativeMapEventHandler>>();
  private readonly latestRenderRevision = new Map<string, number>();
  private readonly activeMapIds = new Set<string>();
  private readonly creatingMapIds = new Set<string>();
  private readonly mapOwners = new Map<string, { token: string; generation: number }>();
  private readonly createFlights = new Map<string, { token: string; generation: number; promise: Promise<unknown> }>();
  private readonly frameByMap = new Map<string, NativeProjectionFrame>();
  private readonly demByMap = new Map<string, NativeDemCache>();
  private sessionValue: string | null = null;
  private helloFlight: Promise<NativeMapHello> | null = null;
  private sessionGeneration = 0;
  private disposed = false;
  private requestCounter = 0;

  constructor(options: NativeMapClientOptions) {
    const win = options.window ?? (typeof window === 'undefined' ? undefined : window as NativeMapWindow);
    if (!win) throw new NativeMapBridgeError('unavailable', 'Native map bridge requires a browser/WebView window.');
    const origin = win.location.origin;
    if (!origin || !options.trustedOrigins.includes(origin)) {
      throw new NativeMapBridgeError('untrusted-origin', 'Native map bridge is blocked outside its configured trusted local origin.', { origin });
    }
    if (!win.ShantuNativeMap || typeof win.ShantuNativeMap.postMessage !== 'function') {
      throw new NativeMapBridgeError('unavailable', 'Native map bridge host is not installed.');
    }
    this.win = win;
    this.transport = win.ShantuNativeMap;
    this.timeoutMs = boundedTimeout(options.timeoutMs ?? 10_000);
    this.makeRequestId = options.createRequestId ?? (() => `${Date.now().toString(36)}-${(++this.requestCounter).toString(36)}-${randomPart()}`);
    this.win.addEventListener('shantu:native-map', this.onHostMessage as EventListener);
  }

  get sessionId() { return this.sessionValue; }
  get isReady() { return this.sessionValue !== null && !this.disposed; }
  get isDisposed() { return this.disposed; }

  async connect(mapId = 'main', signal?: AbortSignal): Promise<NativeMapHello> {
    this.assertOpen();
    if (this.sessionValue) return this.helloValue ?? { capabilities: {} };
    if (this.helloFlight) return this.helloFlight;
    const generation = this.sessionGeneration;
    this.helloFlight = this.requestInternal<NativeMapHello>(mapId, 'hello', { protocolVersion: NATIVE_MAP_PROTOCOL_VERSION }, {
      signal,
      allowNoSession: true,
      hello: true,
    }).then((hello) => {
      if (generation !== this.sessionGeneration || this.disposed) throw new NativeMapBridgeError('stale-session', 'Native map hello reply belongs to an expired bridge session.');
      this.helloValue = hello;
      this.sessionValue = this.helloSessionId;
      this.helloSessionId = null;
      if (!this.sessionValue) throw new NativeMapBridgeError('invalid-hello', 'Native map host did not return a sessionId.');
      dispatchLocal(this.win, 'shantu:native-map-ready', { sessionId: this.sessionValue });
      return hello;
    }).finally(() => { this.helloFlight = null; this.helloSessionId = null; });
    return this.helloFlight;
  }

  private helloValue: NativeMapHello | null = null;
  private helloSessionId: string | null = null;

  request<T = unknown>(mapId: NativeMapId, command: NativeMapCommand | (string & {}), payload?: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
    this.assertSession();
    return this.requestInternal<T>(mapId, command, payload, options);
  }

  async createMap(mapId: NativeMapId, payload: unknown = {}, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<unknown> {
    const owner = readMapOwner(payload);
    if (owner) {
      const active = this.mapOwners.get(mapId);
      if (this.activeMapIds.has(mapId) && active?.token === owner.token && active.generation === owner.generation) {
        return { created: true, existing: true };
      }
      const flight = this.createFlights.get(mapId);
      if (flight) {
        if (flight.token === owner.token && flight.generation === owner.generation) return flight.promise;
        return flight.promise.catch(() => undefined).then(() => this.createMap(mapId, payload, options));
      }
    } else if (this.activeMapIds.has(mapId) || this.creatingMapIds.has(mapId)) {
      throw new NativeMapBridgeError('map-already-created', `Native map '${mapId}' already exists or is being created in this session.`);
    }
    this.creatingMapIds.add(mapId);
    const flightRef: { promise: Promise<unknown> } = { promise: Promise.resolve(undefined) };
    const promise = (async () => {
      try {
        const result = await this.request(mapId, 'create', payload, options);
        if (owner) {
          const acknowledgement = result && typeof result === 'object' && !Array.isArray(result)
            ? result as Record<string, unknown> : null;
          if ((acknowledgement?.ownerToken !== undefined && acknowledgement.ownerToken !== owner.token) ||
            (acknowledgement?.ownerGeneration !== undefined && acknowledgement.ownerGeneration !== owner.generation)) {
            throw new NativeMapBridgeError('stale-map-owner', 'Native map create acknowledgement belongs to a different owner.');
          }
          const currentOwner = this.mapOwners.get(mapId);
          if (currentOwner && !sameMapOwner(currentOwner, owner) && currentOwner.generation >= owner.generation) {
            throw new NativeMapBridgeError('stale-map-owner', 'A newer native map owner is already active.');
          }
          if (!sameMapOwner(currentOwner, owner)) this.clearMapLocalCaches(mapId);
          this.mapOwners.set(mapId, owner);
        }
        this.activeMapIds.add(mapId);
        return result;
      } finally {
        this.creatingMapIds.delete(mapId);
        if (this.createFlights.get(mapId)?.promise === flightRef.promise) this.createFlights.delete(mapId);
      }
    })();
    flightRef.promise = promise;
    if (owner) this.createFlights.set(mapId, { ...owner, promise });
    return promise;
  }

  async disposeMap(mapId: NativeMapId, options: { signal?: AbortSignal; timeoutMs?: number; ownerToken?: string; ownerGeneration?: number } = {}) {
    const localOwner = this.mapOwners.get(mapId);
    if (!this.activeMapIds.has(mapId) && !options.ownerToken) return false;
    if (options.ownerToken && localOwner && localOwner.generation > (options.ownerGeneration ?? 0)) return false;
    const result = await this.request<{ disposed?: boolean; ownerMismatch?: boolean }>(mapId, 'dispose', {
      ...(options.ownerToken ? { ownerToken: options.ownerToken, ownerGeneration: options.ownerGeneration } : {}),
    }, options);
    const currentOwner = this.mapOwners.get(mapId);
    const sameLocalOwner = sameOptionalMapOwner(currentOwner, localOwner);
    const requestMatchesLocalOwner = !options.ownerToken || !localOwner ||
      (localOwner.token === options.ownerToken && localOwner.generation === options.ownerGeneration);
    if (!result.ownerMismatch && sameLocalOwner && requestMatchesLocalOwner) {
      this.activeMapIds.delete(mapId);
      this.mapOwners.delete(mapId);
      this.clearMapLocalCaches(mapId);
    }
    return result.disposed === true;
  }

  setMapViewport(mapId: NativeMapId, viewport: NativeMapRenderState['mapViewport'], options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    return this.request(mapId, 'mapViewport', { mapViewport: viewport }, options);
  }

  batch<T = unknown>(mapId: NativeMapId, commands: readonly { command: NativeMapCommand | (string & {}); payload?: unknown }[], options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    if (commands.length > 64) return Promise.reject(new NativeMapBridgeError('batch-too-large', 'Native map command batch exceeds 64 items.'));
    return this.request<T>(mapId, 'batch', { commands }, options);
  }

  /** Fire-and-forget command. A later unsolicited reply is intentionally ignored. */
  notify(mapId: NativeMapId, command: NativeMapCommand | (string & {}), payload?: unknown): string {
    this.assertSession();
    if (!isValidMapId(mapId)) throw new NativeMapBridgeError('invalid-map-id', 'Map id is invalid.');
    const requestId = this.makeRequestId();
    this.post({ version: NATIVE_MAP_PROTOCOL_VERSION, sessionId: this.sessionValue!, requestId, mapId, command, payload });
    return requestId;
  }

  /** Sends only a newer complete render snapshot; callbacks are excluded by its public type. */
  setRenderState(mapId: NativeMapId, state: NativeMapRenderState, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<NativeMapRenderStateAck> {
    this.assertSession();
    if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw new NativeMapBridgeError('invalid-revision', 'Render state revision must be a non-negative integer.');
    const previous = this.latestRenderRevision.get(mapId) ?? -1;
    const ownerAtSend = this.mapOwners.get(mapId);
    if (state.revision <= previous) return Promise.resolve({ applied: false, revision: previous, reason: 'stale_local_revision' });
    const safe = jsonSnapshot(state);
    this.latestRenderRevision.set(mapId, state.revision);
    return this.request<NativeMapRenderStateAck>(mapId, 'renderState', safe, options).then((ack) => {
      if (sameOptionalMapOwner(this.mapOwners.get(mapId), ownerAtSend) && ack && Number.isSafeInteger(ack.revision) && ack.revision > (this.latestRenderRevision.get(mapId) ?? -1)) {
        this.latestRenderRevision.set(mapId, ack.revision);
      }
      return ack;
    }).catch((error) => {
      if (sameOptionalMapOwner(this.mapOwners.get(mapId), ownerAtSend) && this.latestRenderRevision.get(mapId) === state.revision) this.latestRenderRevision.set(mapId, previous);
      throw error;
    });
  }

  subscribe(mapId: NativeMapId, name: string, listener: NativeMapEventHandler): () => void {
    this.assertOpen();
    if (!isValidMapId(mapId)) throw new NativeMapBridgeError('invalid-map-id', 'Map id is invalid.');
    const key = eventKey(mapId, name);
    const bucket = this.listeners.get(key) ?? new Set<NativeMapEventHandler>();
    bucket.add(listener);
    this.listeners.set(key, bucket);
    return () => {
      bucket.delete(listener);
      if (!bucket.size) this.listeners.delete(key);
    };
  }

  cameraFrame(mapId: NativeMapId): NativeProjectionFrame | null { return this.frameByMap.get(mapId) ?? null; }

  capability(name: string): NativeMapCapability {
    return this.helloValue?.capabilities?.[name] ?? { status: 'blocked', reason: 'capability-not-advertised' };
  }

  /** Map-local CSS geometry uses only the latest real native frame and revisioned DEM cache. */
  geometry(mapId: NativeMapId) {
    return {
      project: (coordinate: Coordinate, altitudeMeters?: number) => projectWgs84(coordinate, this.cameraFrame(mapId), this.demCache(mapId), altitudeMeters),
      unproject: (point: { x: number; y: number }) => unprojectWgs84(point, this.cameraFrame(mapId), this.demCache(mapId)),
      elevation: (coordinate: Coordinate) => {
        const frame = this.cameraFrame(mapId);
        const cache = this.demCache(mapId);
        if (!frame) return { status: 'blocked' as const, reason: 'camera-frame-unavailable' };
        if (frame.demRevision > cache.revision) return { status: 'blocked' as const, reason: 'dem-cache-stale' };
        const value = cache.sample(coordinate[0], coordinate[1]);
        return value === null ? { status: 'blocked' as const, reason: 'dem-sample-unavailable' } : { status: 'ready' as const, value };
      },
    };
  }

  demCache(mapId: NativeMapId): NativeDemCache {
    let cache = this.demByMap.get(mapId);
    if (!cache) { cache = new NativeDemCache(); this.demByMap.set(mapId, cache); }
    return cache;
  }

  private clearMapLocalCaches(mapId: NativeMapId) {
    this.latestRenderRevision.delete(mapId);
    this.frameByMap.delete(mapId);
    this.demByMap.delete(mapId);
  }

  /** Invalidates the active session and all in-flight work; stale responses cannot revive it. */
  dispose(): void {
    if (this.disposed) return;
    if (this.sessionValue) {
      for (const mapId of new Set([...this.activeMapIds, ...this.creatingMapIds])) {
        const requestId = this.makeRequestId();
        const owner = this.mapOwners.get(mapId) ?? this.createFlights.get(mapId);
        try { this.post({ version: NATIVE_MAP_PROTOCOL_VERSION, sessionId: this.sessionValue, requestId, mapId, command: 'dispose', payload: owner ? { ownerToken: owner.token, ownerGeneration: owner.generation } : {} }); } catch { /* local cleanup still runs */ }
      }
    }
    this.disposed = true;
    this.sessionGeneration++;
    this.sessionValue = null;
    this.helloValue = null;
    this.win.removeEventListener('shantu:native-map', this.onHostMessage as EventListener);
    for (const [id, pending] of this.pending) this.finishPending(id, pending, new NativeMapBridgeError('disposed', 'Native map bridge client was disposed.'));
    this.listeners.clear();
    this.latestRenderRevision.clear();
    this.activeMapIds.clear();
    this.creatingMapIds.clear();
    this.mapOwners.clear();
    this.createFlights.clear();
    this.frameByMap.clear();
    this.demByMap.clear();
  }

  private requestInternal<T>(
    mapId: NativeMapId,
    command: string,
    payload: unknown,
    options: { signal?: AbortSignal; timeoutMs?: number; allowNoSession?: boolean; hello?: boolean },
  ): Promise<T> {
    this.assertOpen();
    if (!isValidMapId(mapId)) return Promise.reject(new NativeMapBridgeError('invalid-map-id', 'Map id is invalid.'));
    if (!options.allowNoSession && !this.sessionValue) return Promise.reject(new NativeMapBridgeError('session-not-ready', 'Connect the native map bridge before sending commands.'));
    if (options.signal?.aborted) return Promise.reject(abortError());
    const requestId = this.makeRequestId();
    const timeoutMs = boundedTimeout(options.timeoutMs ?? this.timeoutMs);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        this.finishPending(requestId, pending, new NativeMapBridgeError('timeout', `Native map request '${command}' timed out.`));
        this.cancelRemote(requestId, mapId, options.hello === true);
      }, timeoutMs);
      const pending: PendingRequest = {
        mapId,
        sessionGeneration: this.sessionGeneration,
        resolve: (value) => resolve(value as T),
        reject,
        timer,
        signal: options.signal,
      };
      if (options.signal) {
        pending.abort = () => {
          if (!this.pending.has(requestId)) return;
          this.finishPending(requestId, pending, abortError());
          this.cancelRemote(requestId, mapId, options.hello === true);
        };
        options.signal.addEventListener('abort', pending.abort, { once: true });
      }
      this.pending.set(requestId, pending);
      try { this.post({
        version: NATIVE_MAP_PROTOCOL_VERSION,
        ...(options.allowNoSession ? {} : { sessionId: this.sessionValue! }),
        requestId,
        mapId,
        command: command as NativeMapCommand,
        payload,
      }); } catch (error) {
        const pending = this.pending.get(requestId);
        if (pending) this.finishPending(requestId, pending, error instanceof Error ? error : new NativeMapBridgeError('post-failed', String(error)));
      }
    });
  }

  private cancelRemote(targetRequestId: string, mapId: string, allowNoSession = false) {
    if (!allowNoSession && !this.sessionValue) return;
    try { this.post({
      version: NATIVE_MAP_PROTOCOL_VERSION,
      ...(this.sessionValue ? { sessionId: this.sessionValue } : {}),
      requestId: this.makeRequestId(),
      mapId,
      command: 'cancel',
      payload: { targetRequestId },
    }); } catch { /* the local abort/timeout remains authoritative */ }
  }

  private onHostMessage = (raw: Event) => {
    if (this.disposed) return;
    const detail = (raw as CustomEvent<unknown>).detail;
    const message = normalizeHostMessage(detail);
    if (!message || message.version !== NATIVE_MAP_PROTOCOL_VERSION) return;
    if ((message.type === 'result' || message.type === 'error') && message.requestId && this.pending.has(message.requestId)) {
      const pending = this.pending.get(message.requestId)!;
      if (pending.sessionGeneration !== this.sessionGeneration || pending.mapId !== message.mapId) return;
      if (message.type === 'error') {
        this.finishPending(message.requestId, pending, hostError(message));
        return;
      }
      if (!this.sessionValue && this.pending.get(message.requestId) === pending) {
        const sessionId = message.sessionId ?? readHelloSession(message.payload);
        if (!sessionId) {
          this.finishPending(message.requestId, pending, new NativeMapBridgeError('invalid-hello', 'Native map host did not return a sessionId.'));
          return;
        }
        this.helloSessionId = sessionId;
      } else if (message.sessionId !== this.sessionValue) return;
      this.finishPending(message.requestId, pending, undefined, message.payload);
      return;
    }
    if (!this.sessionValue || message.sessionId !== this.sessionValue || !message.mapId) return;
    if ((message.type === 'result' || message.type === 'error') && message.requestId) {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.mapId !== message.mapId || pending.sessionGeneration !== this.sessionGeneration) return;
      if (message.type === 'error') this.finishPending(message.requestId, pending, hostError(message));
      else this.finishPending(message.requestId, pending, undefined, message.payload);
      return;
    }
    if (message.type !== 'event') return;
    const parsed = eventNameValue(message);
    if (!parsed) return;
    const localName = parsed.name === 'renderFrame' ? 'cameraFrame' : parsed.name;
    if ((parsed.name === 'cameraFrame' || parsed.name === 'renderFrame') && isProjectionFrame(parsed.value)) {
      const current = this.frameByMap.get(message.mapId);
      if (!current || parsed.value.sequence > current.sequence) this.frameByMap.set(message.mapId, parsed.value);
    } else if (parsed.name === 'demCache' && isDemCacheUpdate(parsed.value)) {
      const update = parsed.value;
      this.demCache(message.mapId).replace(update.revision, update.tiles);
    }
    const localEvent = { ...message, payload: { name: localName, value: parsed.value } };
    const buckets = new Set([
      this.listeners.get(eventKey(message.mapId, parsed.name)),
      localName === parsed.name ? undefined : this.listeners.get(eventKey(message.mapId, localName)),
    ].filter((bucket): bucket is Set<NativeMapEventHandler> => !!bucket));
    for (const bucket of buckets) for (const listener of [...bucket]) listener(parsed.value, localEvent);
  };

  private finishPending(id: string, pending: PendingRequest, error?: Error, value?: unknown) {
    if (!this.pending.delete(id)) return;
    clearTimeout(pending.timer);
    if (pending.abort) pending.signal?.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error); else pending.resolve(value);
  }

  private post(message: Record<string, unknown>) {
    try { this.transport.postMessage(JSON.stringify(message)); }
    catch (error) { throw new NativeMapBridgeError('post-failed', 'Unable to send a native map message.', safeError(error)); }
  }

  private assertOpen() { if (this.disposed) throw new NativeMapBridgeError('disposed', 'Native map bridge client was disposed.'); }
  private assertSession() { this.assertOpen(); if (!this.sessionValue) throw new NativeMapBridgeError('session-not-ready', 'Connect the native map bridge before sending commands.'); }
}

export type NativeMapGeometry = ReturnType<NativeMapBridgeClient['geometry']>;

const sharedClients = new WeakMap<object, NativeMapBridgeClient>();

/** One hello/session is shared by both maps and all native-map host clients in the WebView. */
export function getSharedNativeMapClient(options: NativeMapClientOptions): NativeMapBridgeClient {
  const win = options.window ?? (typeof window === 'undefined' ? undefined : window as NativeMapWindow);
  if (!win) throw new NativeMapBridgeError('unavailable', 'Native map bridge requires a browser/WebView window.');
  const previous = sharedClients.get(win as object);
  if (previous && !previous.isDisposed) return previous;
  const client = new NativeMapBridgeClient({ ...options, window: win });
  sharedClients.set(win as object, client);
  return client;
}

function normalizeHostMessage(value: unknown): NativeMapHostMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || !['result', 'error', 'event'].includes(String(raw.type))) return null;
  return raw as NativeMapHostMessage;
}
function eventNameValue(message: NativeMapHostMessage): NativeMapLocalEvent | null {
  const payload = message.payload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.name === 'string') return { name: record.name, value: record.value };
  }
  if (typeof message.event === 'string') return { name: message.event, value: message.value ?? message.payload };
  if (message.event && typeof message.event === 'object' && typeof message.event.name === 'string') return { name: message.event.name, value: message.event.value };
  if (typeof message.name === 'string') return { name: message.name, value: message.value ?? message.payload };
  return null;
}
function hostError(message: NativeMapHostMessage) {
  const raw = message.error ?? message.payload;
  if (typeof raw === 'string') return new NativeMapBridgeError('host-error', raw);
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    return new NativeMapBridgeError(typeof record.code === 'string' ? record.code : 'host-error', typeof record.message === 'string' ? record.message : 'Native map request failed.', record.details);
  }
  return new NativeMapBridgeError('host-error', 'Native map request failed.');
}
function readHelloSession(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = (payload as Record<string, unknown>).sessionId;
  return typeof value === 'string' && value ? value : null;
}
function readMapOwner(payload: unknown): { token: string; generation: number } | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const value = payload as Record<string, unknown>;
  return typeof value.ownerToken === 'string' && value.ownerToken.length > 0 && value.ownerToken.length <= 160 &&
    Number.isSafeInteger(value.ownerGeneration) && (value.ownerGeneration as number) > 0
    ? { token: value.ownerToken, generation: value.ownerGeneration as number } : null;
}
function sameMapOwner(a: { token: string; generation: number } | undefined, b: { token: string; generation: number }) {
  return !!a && a.token === b.token && a.generation === b.generation;
}
function sameOptionalMapOwner(a: { token: string; generation: number } | undefined, b: { token: string; generation: number } | undefined) {
  return a === undefined ? b === undefined : sameMapOwner(a, b!);
}
function isProjectionFrame(value: unknown): value is NativeProjectionFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as NativeProjectionFrame;
  return Number.isSafeInteger(frame.sequence) && frame.sequence >= 0 &&
    Array.isArray(frame.viewProjection) && frame.viewProjection.length === 16 &&
    Array.isArray(frame.inverseViewProjection) && frame.inverseViewProjection.length === 16 &&
    !!frame.viewport && Number.isFinite(frame.cssScale) && typeof frame.clipDepth === 'string';
}
function isDemCacheUpdate(value: unknown): value is { revision: number; tiles: NativeDemTile[] } {
  return !!value && typeof value === 'object' && Number.isSafeInteger((value as { revision?: number }).revision) && Array.isArray((value as { tiles?: unknown }).tiles);
}
function jsonSnapshot<T>(value: T): T {
  const seen = new WeakSet<object>();
  const visit = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new NativeMapBridgeError('invalid-render-state', 'Render state cannot contain NaN or infinity.');
      return input;
    }
    if (input === undefined) return undefined;
    if (typeof input === 'function' || typeof input === 'symbol' || typeof input === 'bigint') {
      throw new NativeMapBridgeError('invalid-render-state', 'Render state must contain JSON data only.');
    }
    if (typeof Blob !== 'undefined' && input instanceof Blob) {
      throw new NativeMapBridgeError('binary-transfer-required', 'Local binary map sources require an explicit native file transfer capability.');
    }
    if (typeof input === 'object') {
      if (seen.has(input)) throw new NativeMapBridgeError('invalid-render-state', 'Render state cannot contain cycles.');
      if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null && !Array.isArray(input)) {
        throw new NativeMapBridgeError('invalid-render-state', 'Render state must contain plain JSON objects only.');
      }
      seen.add(input);
      if (Array.isArray(input)) {
        const result = input.map((item) => {
          if (item === undefined) throw new NativeMapBridgeError('invalid-render-state', 'Render state arrays cannot contain undefined values.');
          return visit(item);
        });
        seen.delete(input);
        return result;
      }
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(input)) {
        if (item === undefined) continue;
        output[key] = visit(item);
      }
      seen.delete(input);
      return output;
    }
    throw new NativeMapBridgeError('invalid-render-state', 'Render state contains unsupported values.');
  };
  return visit(value) as T;
}
function eventKey(mapId: string, name: string) { return `${mapId}\u0000${name}`; }
function isValidMapId(value: string) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(value); }
function boundedTimeout(value: number) { return Number.isFinite(value) ? Math.max(50, Math.min(120_000, Math.round(value))) : 10_000; }
function abortError() { return new NativeMapBridgeError('cancelled', 'Native map request was cancelled.'); }
function safeError(value: unknown) { return value instanceof Error ? value.message : String(value); }
function randomPart() { return Math.random().toString(36).slice(2, 10); }
function dispatchLocal(target: NativeMapWindow, type: string, detail: unknown) {
  const event = typeof CustomEvent === 'function'
    ? new CustomEvent(type, { detail })
    : Object.assign(new Event(type), { detail });
  target.dispatchEvent(event);
}
