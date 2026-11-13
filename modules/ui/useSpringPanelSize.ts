import { useLayoutEffect, type RefObject } from 'react';

/** Animate the surface height, never scale the text or delay the new controls. */
export function useSpringPanelSize(ref: RefObject<HTMLElement | null>, enabled: boolean) {
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!enabled || !panel || typeof ResizeObserver === 'undefined' || !panel.animate) return;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let height = 0;
    let width = 0;
    let animation: Animation | null = null;
    let disposed = false;
    const measure = () => parseFloat(getComputedStyle(panel).height);
    const observer = new ResizeObserver(() => {
      if (disposed || animation) return;
      const next = measure();
      const nextWidth = panel.offsetWidth;
      const previous = height;
      const sameWidth = Math.abs(nextWidth - width) < 1;
      height = next;
      width = nextWidth;
      if (media.matches || !previous || !sameWidth || Math.abs(next - previous) < 1) return;
      // Do not feed our own animated height back into the resize observer.
      observer.unobserve(panel);
      animation = panel.animate([{ height: `${previous}px` }, { height: `${next}px` }], {
        duration: 280,
        easing: 'cubic-bezier(.2,.8,.25,1)',
        fill: 'both',
      });
      animation.onfinish = () => {
        animation?.cancel();
        animation = null;
        if (!disposed) observer.observe(panel);
      };
    });
    const reduce = () => {
      if (!media.matches) return;
      if (animation) { animation.onfinish = null; animation.cancel(); animation = null; }
      height = measure();
      observer.observe(panel);
    };
    observer.observe(panel);
    media.addEventListener('change', reduce);
    return () => {
      disposed = true;
      observer.disconnect();
      media.removeEventListener('change', reduce);
      if (animation) { animation.onfinish = null; animation.cancel(); }
    };
  }, [ref, enabled]);
}
