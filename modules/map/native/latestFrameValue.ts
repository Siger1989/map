export type RequestFrame = (callback: FrameRequestCallback) => number;
export type CancelFrame = (frame: number) => void;

/** Keep only the most recent input value and consume it at most once per animation frame. */
export function createLatestFrameValue<T>(
  consume: (value: T) => void,
  requestFrame: RequestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame: CancelFrame = (frame) => cancelAnimationFrame(frame),
) {
  let frame: number | null = null;
  let pending!: T;
  let hasPending = false;
  let generation = 0;

  const consumePending = () => {
    if (!hasPending) return false;
    const value = pending;
    hasPending = false;
    pending = undefined as T;
    consume(value);
    return true;
  };

  const cancelScheduledFrame = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    generation++;
  };

  return {
    push(value: T) {
      pending = value;
      hasPending = true;
      if (frame !== null) return;
      const scheduledGeneration = ++generation;
      frame = requestFrame(() => {
        if (scheduledGeneration !== generation) return;
        frame = null;
        consumePending();
      });
    },
    /** Replace any queued MOVE with the final UP value, then consume synchronously. */
    flush(finalValue?: T) {
      if (arguments.length > 0) {
        pending = finalValue as T;
        hasPending = true;
      }
      cancelScheduledFrame();
      return consumePending();
    },
    /** Discard queued work and invalidate an already-dispatched callback. */
    cancel() {
      cancelScheduledFrame();
      hasPending = false;
      pending = undefined as T;
    },
    get queued() { return hasPending; },
  };
}
