import { useEffect, useRef } from 'react';
export function useRouteDialogFocus(onBack: () => void) {
  const root = useRef<HTMLElement>(null),
    back = useRef(onBack);
  back.current = onBack;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const node = root.current;
    node
      ?.querySelector<HTMLElement>('button,select,input,[tabindex="0"]')
      ?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        back.current();
      }
      if (event.key !== 'Tab' || !node) return;
      const controls = [
        ...node.querySelectorAll<HTMLElement>(
          'button:not(:disabled),select:not(:disabled),input:not(:disabled),[tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length > 0);
      const first = controls[0],
        last = controls.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !node.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !node.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    node?.addEventListener('keydown', key);
    return () => {
      node?.removeEventListener('keydown', key);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return root;
}
