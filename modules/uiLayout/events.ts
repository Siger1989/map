export const OPEN_LAYOUT_EDITOR = 'shantu:open-layout-editor';
export function openLayoutEditor() {
  window.dispatchEvent(new Event(OPEN_LAYOUT_EDITOR));
}
