import type { CameraSnapshot } from '../../controls/useMapFocusLock.ts';

type Timer = ReturnType<typeof setTimeout>;
type Timers = { set: (callback: () => void, delay: number) => Timer; clear: (timer: Timer) => void };

const copyCamera = (camera: CameraSnapshot): CameraSnapshot => ({ ...camera, center: [...camera.center] });

/** Coalesces persistence side effects while leaving live camera callbacks untouched. */
export class NativeCameraPersistence {
  private latest: CameraSnapshot | null = null;
  private idleTimer: Timer | null = null;
  private maxTimer: Timer | null = null;
  private gestureActive = false;
  private disposed = false;

  constructor(
    private readonly enabled: () => boolean,
    private readonly persist: (camera: CameraSnapshot) => void,
    private readonly idleDelay = 160,
    private readonly maxDelay = 1000,
    private readonly timers: Timers = {
      set: (callback, delay) => globalThis.setTimeout(callback, delay),
      clear: timer => globalThis.clearTimeout(timer),
    },
  ) {
    if (!Number.isFinite(idleDelay) || idleDelay < 0 || !Number.isFinite(maxDelay) || maxDelay < idleDelay) {
      throw new RangeError('Camera persistence delays must satisfy 0 <= idleDelay <= maxDelay');
    }
  }

  beginGesture() {
    if (!this.disposed && this.enabled()) this.gestureActive = true;
    if (this.idleTimer !== null) this.timers.clear(this.idleTimer);
    this.idleTimer = null;
  }

  update(camera: CameraSnapshot) {
    if (this.disposed) return;
    if (!this.enabled()) {
      this.clearPending();
      return;
    }
    this.latest = copyCamera(camera);
    if (this.maxTimer === null) this.maxTimer = this.timers.set(() => this.flush(), this.maxDelay);
    this.scheduleIdleFlush();
  }

  endGesture() {
    if (this.disposed) return;
    this.gestureActive = false;
    if (this.latest) this.scheduleIdleFlush();
  }

  /** Flushes the last observed camera; call before releasing the map owner. */
  flush() {
    this.clearTimers();
    const camera = this.latest;
    this.latest = null;
    if (!camera || this.disposed || !this.enabled()) return;
    this.persist(camera);
  }

  /** Flush then prevent any late timer or frame from writing after teardown. */
  dispose() {
    if (this.disposed) return;
    this.flush();
    this.gestureActive = false;
    this.disposed = true;
  }

  private scheduleIdleFlush() {
    if (this.gestureActive) return;
    if (this.idleTimer !== null) this.timers.clear(this.idleTimer);
    this.idleTimer = this.timers.set(() => this.flush(), this.idleDelay);
  }

  private clearPending() {
    this.latest = null;
    this.clearTimers();
  }

  private clearTimers() {
    if (this.idleTimer !== null) this.timers.clear(this.idleTimer);
    if (this.maxTimer !== null) this.timers.clear(this.maxTimer);
    this.idleTimer = null;
    this.maxTimer = null;
  }
}
