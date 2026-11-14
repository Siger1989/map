import { useEffect } from 'react';
import { panelMotion } from './panelMotion';
import { trackPanelMotion } from './panelMotionEvents';

/** Cosmetic feedback only: never cancels input or changes business state. */
export function useSpringInteractions() {
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const animations = new Map<HTMLElement, Animation>();
    const pressed = new Map<number, HTMLElement>();
    const panels = '.control-popover,.route-dialog,.route-surface,.measurement-panel,.section-panel,.pin-editor,.marker-workspace,.photo-lightbox,.home-route-card,.home-map-popup,.track-tools,.track-draw-hint,.position-status,.raster-level-panel,.direction-menu,.geology-panel,[role="dialog"]';
    const eligible = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest('[inert],[data-layout-editing="true"]')) return null;
      const button = target.closest<HTMLElement>('button,summary');
      if (!button || button.matches(':disabled,[aria-disabled="true"],[role="switch"],.switch') || button.closest('.maplibregl-canvas-container')) return null;
      return button.closest('.observatory.home-map,.route-dialog,[role="dialog"],.app-color-dialog') ? button : null;
    };
    const animate = (element: HTMLElement, frames: Keyframe[], duration: number, hold = false) => {
      animations.get(element)?.cancel();
      if (media.matches || !element.isConnected || !element.animate) return;
      const animation = element.animate(frames, { duration, easing: 'ease-out', fill: hold ? 'forwards' : 'none' });
      // Standalone popups use this observer rather than SpringPresence. Publish
      // their final glass geometry too; button/knob feedback needs no sampling.
      const stopMotion = element.matches(panels) ? trackPanelMotion(element, animation) : undefined;
      animations.set(element, animation);
      animation.finished.catch(() => {}).finally(() => { stopMotion?.(); if (!hold && animations.get(element) === animation) animations.delete(element); });
    };
    const release = (button: HTMLElement) => animate(button, [
      { scale: '.96 .93' }, { scale: '1.035 1.025', offset: .42 },
      { scale: '.992 1', offset: .7 }, { scale: '1' },
    ], 360);
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const button = eligible(event.target); if (!button) return;
      pressed.set(event.pointerId, button);
      animate(button, [{ scale: '1' }, { scale: '.97 .94' }], 90, true);
    };
    const up = (event: PointerEvent) => {
      const button = pressed.get(event.pointerId); pressed.delete(event.pointerId);
      if (button) release(button);
    };
    const cancel = (event: PointerEvent) => { const button = pressed.get(event.pointerId); if (button) animations.get(button)?.cancel(); pressed.delete(event.pointerId); };
    const click = (event: MouseEvent) => { if (event.detail === 0) { const button = eligible(event.target); if (button) release(button); } };
    // Legacy switches and MapSwitch share one observer; React remains state owner.
    const switchState = (element: Element) => {
      if (!(element instanceof HTMLElement)) return;
      const knob = element.matches('.map-switch') ? element.querySelector<HTMLElement>('.map-switch__track > span') : element.matches('.switch') ? element.querySelector<HTMLElement>('span') : null;
      if (!knob) return;
      const on = element.getAttribute(element.matches('.map-switch') ? 'data-checked' : 'aria-checked') === 'true';
      const end = on ? 14 : 0, from = on ? 0 : 14, direction = on ? 1 : -1;
      const current = animations.has(knob) ? getComputedStyle(knob).transform : `translateX(${from}px)`;
      animate(knob, [
        { transform: current === 'none' ? `translateX(${from}px)` : current },
        { transform: `translateX(${from + direction * 8}px) scale(1.15,.88)`, offset: .22 },
        { transform: `translateX(${end + direction}px) scale(.9,1.08)`, offset: .5 },
        { transform: `translateX(${end - direction * .5}px) scale(1.035,.98)`, offset: .75 },
        { transform: `translateX(${end}px)` },
      ], 380);
    };
    const enter = (node: HTMLElement) => {
      if (node.closest('[data-spring-presence]') || node.closest('[hidden],[inert]') || node.getBoundingClientRect().height === 0) return;
      // Individual transform properties preserve translate() used for map anchoring.
      const motion = panelMotion(node);
      animate(node, [{ scale: '.94', translate: motion.from, opacity: .4 }, { scale: '1.018', translate: motion.rebound, opacity: 1, offset: .55 }, { scale: '1', translate: '0 0', opacity: 1 }].map(frame => ({ ...frame, transformOrigin: motion.origin })), 380);
    };
    const observer = new MutationObserver(records => {
      const added = new Set<HTMLElement>();
      for (const record of records) {
        if (record.type === 'attributes') { switchState(record.target as Element); continue; }
        for (const removed of record.removedNodes) if (removed instanceof Element) for (const [el,a] of animations) if (removed === el || removed.contains(el)) { a.cancel(); animations.delete(el); }
        for (const node of record.addedNodes) if (node instanceof HTMLElement) {
          if (node.matches(panels)) added.add(node);
          node.querySelectorAll<HTMLElement>(panels).forEach(el => added.add(el));
        }
      }
      // Animate the outer surface only, not every nested panel.
      for (const node of added) if (![...added].some(parent => parent !== node && parent.contains(node))) enter(node);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-checked','aria-checked'] });
    const stop = () => { animations.forEach(a => a.cancel()); animations.clear(); pressed.clear(); };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancel, true);
    document.addEventListener('click', click, true);
    window.addEventListener('blur', stop); media.addEventListener('change', stop);
    return () => { observer.disconnect(); stop(); document.removeEventListener('pointerdown',down,true); document.removeEventListener('pointerup',up,true); document.removeEventListener('pointercancel',cancel,true); document.removeEventListener('click',click,true); window.removeEventListener('blur',stop); media.removeEventListener('change',stop); };
  }, []);
}
