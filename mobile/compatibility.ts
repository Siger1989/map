import { installRelationalLayout } from './relationalLayout';
import { installAbortCompatibility } from '../modules/compatibility/abort';

installAbortCompatibility();

// The APK root already resizes for system bars and keyboard. Older WebViews
// need a measured replacement for dvh, including values held in CSS variables.
const root = document.documentElement;
if (CSS.supports('height', '100dvh'))
  root.style.setProperty('--shantu-vh', '1dvh');
else {
  let frame = 0;
  const resize = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      root.style.setProperty(
        '--shantu-vh',
        `${(window.visualViewport?.height ?? window.innerHeight) / 100}px`,
      );
    });
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });
  window.visualViewport?.addEventListener('resize', resize, { passive: true });
}

export function installLayoutCompatibility() {
  installRelationalLayout();
}
