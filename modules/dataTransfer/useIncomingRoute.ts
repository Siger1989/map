import { useEffect, useRef, useState } from 'react';
type Incoming = { token: string; files?: File[]; error?: string; status?: string };
type Bridge = { incomingRouteInfo(): string; incomingRouteChunk(token: string, offset: number): string; incomingRouteDismiss(token: string): void };
function bridge(): Bridge | undefined {
  const native = (window as unknown as { GuanyunNative?: Partial<Bridge> }).GuanyunNative;
  return typeof native?.incomingRouteInfo === 'function' && typeof native.incomingRouteChunk === 'function' && typeof native.incomingRouteDismiss === 'function' ? native as Bridge : undefined;
}
/** Cold start and an already-open app use the same preview, without navigating/reloading the map. */
export function useIncomingRoute() {
  const [incoming, setIncoming] = useState<Incoming | null>(null);
  const handled = useRef('');
  useEffect(() => {
    const native = bridge(); if (!native) return;
    let alive = true, reading = '', timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      if (!alive || document.hidden) return;
      clearTimeout(timer);
      try {
        const info = JSON.parse(native.incomingRouteInfo()) as { token?: string; state?: string; name?: string; size?: number; error?: string };
        const token = info.token;
        if (!token || handled.current === token || reading === token) return;
        if (info.state === 'loading') {
          setIncoming({ token, status: '正在读取收到的路线文件…' });
          timer = setTimeout(check, 500); return;
        }
        if (info.state === 'error') {
          handled.current = token; setIncoming({ token, error: info.error || '文件读取失败，请保存到本机后重试' }); return;
        }
        if (info.state !== 'ready') return;
        reading = token;
        setIncoming({ token, status: '正在接收路线，完成后显示预览…' });
        const size = info.size ?? 0;
        if (!Number.isInteger(size) || size <= 0 || size > 8 * 1024 * 1024) throw Error('文件为空或超过 8 MB');
        const bytes = new Uint8Array(size);
        for (let offset = 0; offset < size;) {
          if (!alive || handled.current === token) return;
          const text = atob(native.incomingRouteChunk(token, offset));
          if (!text.length || text.length > 48*1024 || offset + text.length > size) throw Error('文件接收中断，请重新打开');
          for (let i=0;i<text.length;i++) bytes[offset+i]=text.charCodeAt(i);
          offset += text.length;
          await new Promise<void>(resolve=>setTimeout(resolve,0));
        }
        if (!alive || handled.current === token) return;
        handled.current = token;
        setIncoming({ token, files: [new File([bytes], info.name || '路线.gpx')] });
      } catch (error) {
        if (alive && reading) { handled.current = reading; setIncoming({ token: reading, error: error instanceof Error ? error.message : '文件接收失败' }); }
      } finally { reading = ''; }
    };
    const listener = () => { void check(); };
    window.addEventListener('shantu-incoming-route', listener);
    window.addEventListener('focus', listener);
    document.addEventListener('visibilitychange', listener);
    void check();
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('shantu-incoming-route', listener); window.removeEventListener('focus', listener); document.removeEventListener('visibilitychange', listener); };
  }, []);
  const dismiss = () => {
    if (incoming) { handled.current = incoming.token; bridge()?.incomingRouteDismiss(incoming.token); }
    setIncoming(null);
  };
  return { incoming, dismiss };
}
