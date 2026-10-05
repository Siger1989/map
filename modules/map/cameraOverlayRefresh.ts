/** jumpTo emits moveend on every follower frame; refresh projected handles once
 * after the last frame. A real gesture ending still refreshes immediately. */
export function cameraOverlayRefresh(run: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    request(programmatic: boolean) {
      cancel();
      if (!programmatic) run();
      else timer = setTimeout(() => { timer = undefined; run(); }, 100);
    },
    cancel,
  };
}
