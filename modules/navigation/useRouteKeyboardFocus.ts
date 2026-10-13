import { useEffect, type RefObject } from 'react';
import { searchViewport } from '../input/floatingGeometry';

/** Keep the active route field above the IME by scrolling inside its existing card. */
export function useRouteKeyboardFocus(rows: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    let frame = 0;
    let content: HTMLElement | null = null;
    const reveal = () => {
      frame = 0;
      content = rows.current?.closest<HTMLElement>('.dock-content') ?? null;
      if (!content) return;
      if (document.documentElement.dataset.shantuKeyboard !== 'open') {
        content.style.removeProperty('--route-keyboard-scroll-space');
        return;
      }
      const viewport = searchViewport();
      const bounds = content.getBoundingClientRect();
      const bottom = Math.min(bounds.bottom, viewport.top + viewport.height - 8);
      const top = Math.max(bounds.top, viewport.top) + 4;
      content.style.setProperty('--route-keyboard-scroll-space', `${Math.max(0, bounds.bottom - bottom)}px`);
      const active = document.activeElement;
      if (!(active instanceof HTMLInputElement) || !rows.current?.contains(active) || bottom <= top) return;
      const rect = active.getBoundingClientRect();
      if (rect.bottom > bottom) content.scrollTop += rect.bottom - bottom;
      else if (rect.top < top) content.scrollTop -= top - rect.top;
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };
    document.addEventListener('focusin', schedule);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      content?.style.removeProperty('--route-keyboard-scroll-space');
      document.removeEventListener('focusin', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [rows]);
}
