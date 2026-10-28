type Timer = ReturnType<typeof setTimeout>;
type Timers = { set: (callback: () => void, delay: number) => Timer; clear: (timer: Timer) => void };

/** A failed initial ACK may retry while foregrounded, without a focus/resume event. */
export class NativeInitializationRetry {
  private timer: Timer | null = null;
  private retryIndex = 0;

  constructor(
    private readonly allowed: () => boolean,
    private readonly delays: readonly number[] = [500, 1500, 3000],
    private readonly timers: Timers = {
      set: (callback, delay) => globalThis.setTimeout(callback, delay),
      clear: timer => globalThis.clearTimeout(timer),
    },
  ) {}

  schedule(retry: () => void): boolean {
    if (!this.allowed() || this.timer !== null || this.retryIndex >= this.delays.length) return false;
    const delay = this.delays[this.retryIndex++]!;
    this.timer = this.timers.set(() => {
      this.timer = null;
      if (this.allowed()) retry();
    }, delay);
    return true;
  }

  cancel() {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  /** Only explicit foreground recovery or a completed initialization renews the budget. */
  reset() { this.cancel(); this.retryIndex = 0; }
}
