import type { ViewState } from './types';

/** Map gestures stay native; only the surrounding React controls are throttled. */
export function cameraViewPublisher(
  publish: (view: ViewState) => void,
  now: () => number = () => performance.now(),
) {
  let previous: ViewState | null = null;
  let publishedAt = -Infinity;
  return (view: ViewState, final = false) => {
    if (previous && previous.bearing === view.bearing &&
        previous.pitch === view.pitch && previous.zoom === view.zoom) return;
    const time = now();
    if (!final && time - publishedAt < 100) return;
    previous = { ...view };
    publishedAt = time;
    publish(view);
  };
}
