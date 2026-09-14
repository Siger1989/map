import { useEffect, useRef } from 'react';

/** Publish the occupied height for map controls without sharing component internals. */
export function useDockClearance(variable: string) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const dock = ref.current,
      root = dock?.closest('main');
    if (!dock || !root) return;
    const update = () =>
      root.style.setProperty(
        variable,
        `${Math.ceil(dock.getBoundingClientRect().height) + 24}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(dock);
    update();
    return () => {
      observer.disconnect();
      root.style.removeProperty(variable);
    };
  }, [variable]);
  return ref;
}
