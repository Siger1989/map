import { dimensions, type Annotation } from './data.ts';
/** Keep a whole model in a phone viewport; fixed street-level zoom hides large extrusions. */
export function annotationViewZoom(item: Annotation) {
  if (item.kind === 'pin') return 16;
  const diameter = Math.max(10, Math.hypot(...dimensions(item)));
  return Math.max(
    3,
    Math.min(
      18,
      Math.log2(
        (40075016.6856 *
          Math.cos((item.coordinates[1] * Math.PI) / 180) *
          140) /
          (512 * diameter),
      ),
    ),
  );
}
