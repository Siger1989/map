import { useEffect, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

/** Browser fullscreen must begin with the user's click; Android uses native immersion. */
export function FullscreenButton({ compact = false }: { compact?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setAvailable(Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
    const changed = () => setActive(Boolean(document.fullscreenElement));
    changed();
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  if (!available) return null;
  return <>
    <button aria-label={active ? '退出网页全屏' : '网页全屏'} title={active ? '退出全屏' : '全屏'} onClick={async () => {
      setError('');
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      } catch { setError('浏览器未允许全屏'); }
    }}>
      {active ? <Minimize size={18} /> : <Maximize size={18} />}
      {!compact && (active ? '退出全屏' : '全屏')}
    </button>
    {error && <span role="alert">{error}</span>}
  </>;
}
