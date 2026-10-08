/** Detects the trusted same-origin desktop shell iframe at render time. */
export function isDesktopShell(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.frameElement?.getAttribute('data-shantu-desktop') === 'true';
  } catch {
    return false;
  }
}
