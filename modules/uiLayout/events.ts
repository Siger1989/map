export const OPEN_LAYOUT_EDITOR = 'shantu:open-layout-editor';
/** Layout controls are outside map panels, but using them must preserve the current page. */
export function isLayoutInteraction(event: Event) {
  return event
    .composedPath()
    .some(
      (target) =>
        target instanceof Element &&
        target.matches('[data-layout-ignore], [data-layout-entry]'),
    );
}
export function openLayoutEditor() {
  window.dispatchEvent(new Event(OPEN_LAYOUT_EDITOR));
}
