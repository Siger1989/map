import { markerPresentation, markerScale } from '../annotations/markerScale.ts';

export const MIN_PHOTO_FRAME_CSS = 20;

/** Follow map zoom while keeping distant thumbnails large enough to recognize. */
export function photoMapPresentation(zoom: number) {
  const mode = markerPresentation(zoom, false);
  const frameCss = Math.max(MIN_PHOTO_FRAME_CSS,
    (mode === 'label' ? 32 : mode === 'icon' ? 24.2 : 9.9) * markerScale(zoom));
  const scale = frameCss / 56;
  return { mode, frameCss, scale, canvasCss: 64 * scale };
}
