type FrameRequest = (callback: FrameRequestCallback) => number;
type FrameCancel = (handle: number) => void;

/** Coalesce layout-driven ResizeObserver bursts without changing the map camera. */
export function mapResizeScheduler(
  resize: () => void,
  requestFrame: FrameRequest = requestAnimationFrame,
  cancelFrame: FrameCancel = cancelAnimationFrame,
) {
  let frame = 0;
  let pending: [number, number] | null = null;
  let applied: [number, number] | null = null;

  const cancel = () => {
    if (frame) cancelFrame(frame);
    frame = 0;
    pending = null;
  };

  return {
    request(width: number, height: number) {
      pending = [width, height];
      if (frame) return;
      frame = requestFrame(() => {
        frame = 0;
        const next = pending;
        pending = null;
        if (!next || (applied && applied[0] === next[0] && applied[1] === next[1])) return;
        applied = next;
        resize();
      });
    },
    cancel,
  };
}
