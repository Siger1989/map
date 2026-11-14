/** WAAPI does not emit CSS animationstart/animationend. Surface consumers must
 * still sample entrance/size animation frames and publish their final geometry. */
export const PANEL_MOTION_EVENT = 'shantu:panel-motion';
export type PanelMotionDetail = { element: HTMLElement; phase: 'start' | 'settled' };

export function trackPanelMotion(element: HTMLElement, animation: Animation): () => void {
  let active = true;
  const notify = (phase: PanelMotionDetail['phase']) => {
    const doc = element.ownerDocument;
    const EventType = doc.defaultView?.CustomEvent;
    if (EventType) doc.dispatchEvent(new EventType<PanelMotionDetail>(PANEL_MOTION_EVENT, {
      detail: { element, phase },
    }));
  };
  const settle = () => {
    if (!active) return;
    active = false;
    animation.removeEventListener('finish', settle);
    animation.removeEventListener('cancel', settle);
    // Dispatch on the document even after removal so the native backing clears.
    notify('settled');
  };
  animation.addEventListener('finish', settle);
  animation.addEventListener('cancel', settle);
  notify('start');
  return settle;
}
