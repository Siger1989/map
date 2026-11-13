import {
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from 'react';
import { useSpringPanelSize } from './useSpringPanelSize';
import { panelMotion } from './panelMotion';

type PresenceElement = ReactElement<{ ref?: Ref<HTMLElement>; inert?: boolean; 'aria-hidden'?: boolean }>;

/** Retains the last open panel and animates that panel without adding a DOM node. */
export function SpringPresence({ open, children }: { open: boolean; children: PresenceElement }) {
  const targetRef = useRef<HTMLElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [lastChildren, setLastChildren] = useState<PresenceElement | null>(open ? children : null);
  useSpringPanelSize(targetRef, open && mounted);

  if (open && lastChildren !== children) setLastChildren(children);

  useLayoutEffect(() => {
    if (open && !mounted) {
      setMounted(true);
      return;
    }
    if (!mounted) return;

    const target = targetRef.current;
    const view = target?.ownerDocument.defaultView;
    const media = view?.matchMedia?.('(prefers-reduced-motion: reduce)');
    const reduced = media?.matches ?? false;
    const animate = target?.animate;
    if (!target || reduced || typeof animate !== 'function') {
      if (!open) setMounted(false);
      return;
    }

    const motion = panelMotion(target);
    const animation = animate.call(target, (open
      ? [
          { scale: '0.96', translate: motion.from, opacity: 0 },
          { scale: '1.015', translate: motion.rebound, opacity: 1, offset: 0.78 },
          { scale: '1', translate: '0px 0px', opacity: 1 },
        ]
      : [
          { scale: '1', translate: '0px 0px', opacity: 1 },
          { scale: '0.985', translate: motion.to, opacity: 0 },
        ]).map(frame => ({ ...frame, transformOrigin: motion.origin })), {
      duration: open ? 440 : 135,
      easing: open ? 'cubic-bezier(0.2, 1.35, 0.4, 1)' : 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'both',
    });

    const onReducedMotionChange = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      animation.onfinish = null;
      animation.cancel();
      if (!open) setMounted(false);
    };
    media?.addEventListener?.('change', onReducedMotionChange);
    if (!open) animation.onfinish = () => setMounted(false);

    return () => {
      media?.removeEventListener?.('change', onReducedMotionChange);
      animation.onfinish = null;
      animation.cancel();
    };
  }, [open, mounted]);

  if (!mounted || !lastChildren) return null;
  const childRef = lastChildren.props.ref;
  return cloneElement(lastChildren, {
    ref: (element: HTMLElement | null) => {
      targetRef.current = element;
      if (typeof childRef === 'function') childRef(element);
      else if (childRef) (childRef as { current: HTMLElement | null }).current = element;
    },
    inert: !open,
    'aria-hidden': open ? undefined : true,
  });
}
