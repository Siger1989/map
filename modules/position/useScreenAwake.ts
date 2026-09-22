import { useEffect } from 'react';
/** One owner for foreground screen policy; recording continues in its native service when locked. */
export function useScreenAwake(enabled: boolean) {
  useEffect(() => {
    const bridge = window.GuanyunNative;
    if (bridge?.setKeepScreenOn) {
      const sync = () => bridge.setKeepScreenOn?.(enabled);
      sync(); window.addEventListener('focus', sync); document.addEventListener('visibilitychange', sync);
      return () => { window.removeEventListener('focus', sync); document.removeEventListener('visibilitychange', sync); bridge.setKeepScreenOn?.(false); };
    }
    let disposed = false, pending = false;
    let lock: WakeLockSentinel | null = null;
    const sync = async () => {
      if (!enabled || disposed || document.hidden || lock || pending || !navigator.wakeLock) return;
      pending = true;
      try { const value = await navigator.wakeLock.request('screen'); if (disposed) { await value.release(); return; } lock=value; value.addEventListener('release', () => { lock=null; }); } catch { /* Unsupported/denied: native APK is the primary delivery. */ }
      finally { pending=false; }
    };
    void sync(); document.addEventListener('visibilitychange', sync); window.addEventListener('focus', sync);
    return () => { disposed=true; void lock?.release(); document.removeEventListener('visibilitychange', sync); window.removeEventListener('focus', sync); };
  }, [enabled]);
}
