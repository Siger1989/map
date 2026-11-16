import type { GlassRect, NativeGlassRegion } from './native-glass-regions.ts';

const RETICLES = '.map-center-cursor,.map-comparison-cross';
const COVERED = 'data-native-reticle-covered';

/** Native glass is behind the whole WebView. Suppress intersecting DOM reticles
 * without changing their geometry or the ground coordinate used for marking. */
export function reticleCovered(rect: GlassRect, surfaces: readonly NativeGlassRegion[]): boolean {
  if (rect.right <= rect.left || rect.bottom <= rect.top) return false;
  return surfaces.some(surface => surface.opacity > 0.01 &&
    rect.left < surface.right && rect.right > surface.left &&
    rect.top < surface.bottom && rect.bottom > surface.top);
}

export function createNativeReticleOcclusion(doc: Document) {
  const owned = new Set<Element>();
  return {
    update(surfaces: readonly NativeGlassRegion[]) {
      for (const element of owned) if (!element.isConnected) {
        element.removeAttribute(COVERED);
        owned.delete(element);
      }
      for (const element of doc.querySelectorAll(RETICLES)) {
        if (reticleCovered(element.getBoundingClientRect(), surfaces)) {
          if (!element.hasAttribute(COVERED)) element.setAttribute(COVERED, 'true');
          owned.add(element);
        } else {
          element.removeAttribute(COVERED);
          owned.delete(element);
        }
      }
    },
    clear() {
      for (const element of owned) element.removeAttribute(COVERED);
      owned.clear();
    },
  };
}
