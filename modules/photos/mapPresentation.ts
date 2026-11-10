import { markerPresentation, markerScale } from '../annotations/markerScale.ts';

/** A compact photo frame follows both the marker modes and the shared continuous zoom curve. */
export function photoMapPresentation(zoom: number) {
  const mode = markerPresentation(zoom, false);
  const frameCss = (mode === 'label' ? 32 : mode === 'icon' ? 24.2 : 9.9) * markerScale(zoom);
  const scale = frameCss / 56;
  return { mode, frameCss, scale, canvasCss: 64 * scale };
}
