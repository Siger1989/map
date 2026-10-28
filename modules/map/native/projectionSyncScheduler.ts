type Timer = ReturnType<typeof setTimeout>;
type Timers = { set: (callback: () => void, delay: number) => Timer; clear: (timer: Timer) => void };

/** Both real frames and newly cached DEM can change local photo projection. */
export function subscribeNativeProjectionEvents(
  client: { subscribe: (mapId: string, name: 'renderFrame' | 'demCache', listener: (value: unknown) => void) => () => void },
  mapId: string,
  onEvent: (name: 'renderFrame' | 'demCache', value: unknown) => void,
): Array<() => void> {
  return (['renderFrame', 'demCache'] as const).map(name => client.subscribe(mapId, name, value => onEvent(name, value)));
}

/** Only representative/group membership is camera-dependent; Blob/record contents are excluded. */
export function nativePhotoGroupKey(photos: readonly { id: string; groupIds?: readonly string[] }[]): string {
  return photos.length ? JSON.stringify(photos.map(photo => [photo.id, ...(photo.groupIds ?? [photo.id])])) : '';
}

/** Coalesce projection/DEM changes without postponing the first pending publication. */
export class NativeProjectionSyncScheduler {
  private timer: Timer | null = null;
  private latest: (() => void) | null = null;

  constructor(
    private readonly ready: () => boolean,
    private readonly delay = 180,
    // Browser timer functions require their Window receiver. Calling an extracted
    // setTimeout as timers.set() otherwise throws Illegal invocation in WebView.
    private readonly timers: Timers = {
      set: (callback, delay) => globalThis.setTimeout(callback, delay),
      clear: timer => globalThis.clearTimeout(timer),
    },
  ) {}

  schedule(publish: () => void) {
    // Initial render-state ACK owns initialization. Background frames must never
    // start another sync (and abort that initial request) before created=true.
    if (!this.ready()) return;
    this.latest = publish;
    if (this.timer !== null) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      const latest = this.latest;
      this.latest = null;
      if (this.ready()) latest?.();
    }, this.delay);
  }

  scheduleWhenChanged(readLatestKey: () => string, readAcknowledgedKey: () => string | null, publish: () => void) {
    this.schedule(() => {
      if (readLatestKey() !== readAcknowledgedKey()) publish();
    });
  }

  cancel() {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.latest = null;
  }
}
