import { markerPresentation } from '../annotations/markerScale.ts';

/** Follow the visible pin sizes; its generic zoom curve is overridden by the pin mode CSS. */
export function photoMapPresentation(zoom: number) {
  const mode = markerPresentation(zoom, false);
  const markerSize = mode === 'label' ? 40 : mode === 'icon' ? 22 : 9;
  const frameCss = markerSize * 1.1;
  const scale = frameCss / 56;
  return { mode, frameCss, scale, canvasCss: 64 * scale };
}
