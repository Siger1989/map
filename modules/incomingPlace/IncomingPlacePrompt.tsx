'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RoutePlace } from '../navigation/types';
import { parseIncomingPlace, type ParsedIncomingPlace } from './parser';

type PlaceBridge = {
  incomingPlaceInfo(): string;
  incomingPlaceDismiss(token: string): void;
  incomingPlaceRetry?(token: string): void;
};
type IncomingState = { token: string; raw: string; parsed: ParsedIncomingPlace | null; resolving?: boolean; retryable?: boolean };

function nativeBridge(): PlaceBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const candidate = (window as unknown as { GuanyunNative?: Partial<PlaceBridge> }).GuanyunNative;
  return typeof candidate?.incomingPlaceInfo === 'function' && typeof candidate?.incomingPlaceDismiss === 'function'
    ? candidate as PlaceBridge : undefined;
}

/** Google shares auto-save only after strict coordinate parsing; navigation remains an explicit action. */
export function IncomingPlacePrompt({ onNavigate, onSave, onAutoSave, saveError, onDismiss }: {
  onNavigate: (place: RoutePlace) => boolean | void;
  onSave?: (place: RoutePlace) => boolean;
  onAutoSave?: (place: RoutePlace) => boolean;
  saveError?: string;
  onDismiss?: () => void;
}) {
  const [incoming, setIncoming] = useState<IncomingState | null>(null);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [autoResult, setAutoResult] = useState<{ token: string; ok: boolean } | null>(null);
  const attemptedToken = useRef('');
  useEffect(() => setSaveAttempted(false), [incoming?.token]);
  const handledToken = useRef('');

  const dismiss = useCallback((token: string, notify = true) => {
    handledToken.current = token;
    nativeBridge()?.incomingPlaceDismiss(token);
    setIncoming(null);
    if (notify) onDismiss?.();
  }, [onDismiss]);

  useEffect(() => {
    let alive = true;
    const check = () => {
      const native = nativeBridge();
      if (!native || document.hidden) return;
      try {
        const info = JSON.parse(native.incomingPlaceInfo()) as { token?: unknown; raw?: unknown; reason?: unknown; title?: unknown; state?: unknown; retryable?: unknown };
        if (typeof info.token !== 'string' || !info.token || info.token === handledToken.current || typeof info.raw !== 'string') return;
        if (info.state === 'resolving') {
          if (alive) setIncoming({ token: info.token, raw: '', parsed: null, resolving: true });
          return;
        }
        if (info.raw.length > 8192) {
          if (alive) setIncoming({ token: info.token, raw: '', parsed: { kind: 'unsupported', reason: '分享内容过长，无法安全读取。' } });
          return;
        }
        const parsed = info.raw ? parseIncomingPlace(info.raw, typeof info.title === 'string' ? info.title : undefined) : {
          kind: 'unsupported' as const,
          reason: typeof info.reason === 'string' && info.reason ? info.reason : '分享内容无法安全读取。',
        };
        if (alive) setIncoming({ token: info.token, raw: info.raw, parsed, retryable: info.retryable === true });
      } catch { /* A malformed external intent never becomes a destination. */ }
    };
    const listener = () => check();
    window.addEventListener('shantu-incoming-place', listener);
    window.addEventListener('focus', listener);
    document.addEventListener('visibilitychange', listener);
    check();
    return () => {
      alive = false;
      window.removeEventListener('shantu-incoming-place', listener);
      window.removeEventListener('focus', listener);
      document.removeEventListener('visibilitychange', listener);
    };
  }, []);

  const saveGoogle = useCallback((state: IncomingState, retry = false) => {
    if (!onAutoSave || state.parsed?.kind !== 'place' || state.parsed.format !== 'google-maps') return;
    if (!retry && attemptedToken.current === state.token) return;
    attemptedToken.current = state.token;
    setSaveAttempted(true);
    let ok = false;
    try { ok = onAutoSave(state.parsed.place); } catch { /* Preserve the received place for an explicit retry. */ }
    setAutoResult({ token: state.token, ok });
  }, [onAutoSave]);
  useEffect(() => { if (incoming) saveGoogle(incoming); }, [incoming, saveGoogle]);

  if (!incoming) return null;
  const place = incoming.parsed?.kind === 'place' ? incoming.parsed.place : null;
  const unsupportedReason = incoming.parsed?.kind === 'unsupported' ? incoming.parsed.reason : '';
  const automatic = incoming.parsed?.kind === 'place' && incoming.parsed.format === 'google-maps' && !!onAutoSave;
  const saved = automatic && autoResult?.token === incoming.token && autoResult.ok;
  const failedSave = automatic && autoResult?.token === incoming.token && !autoResult.ok;
  return <section role="dialog" aria-labelledby="incoming-place-title" aria-modal="false" aria-busy={incoming.resolving || undefined} style={{
    position: 'fixed', left: 12, right: 80,
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 78px)', zIndex: 12000,
    maxWidth: 300, maxHeight: 200, display: 'flex', flexDirection: 'column', padding: 8, borderRadius: 8,
    color: 'var(--ui-ink, #f2f5ed)', background: 'var(--ui-surface, #18201f)', border: '1px solid var(--ui-line, rgba(200,232,221,.24))',
    boxShadow: '0 8px 28px rgba(0,0,0,.36)', font: '14px/1.45 system-ui, sans-serif',
  }}>
    <h2 id="incoming-place-title" style={{ margin: '0 0 4px', flexShrink: 0, fontSize: 14, fontWeight: 650 }}>
      {incoming.resolving ? '正在读取 Google 地点…' : saved ? '已添加 Google 地点' : place ? '收到一个地点' : '无法读取这个地点分享'}
    </h2>
    <div style={{ overflowY: 'auto', minHeight: 0 }}>
    {place ? <>
      <div style={{ fontWeight: 600 }}>{place.name}</div>
      {place.detail && <div style={{ marginTop: 3, color: 'var(--ui-muted, #c2d5d1)' }}>{place.detail}</div>}
      <div style={{ marginTop: 5, color: 'var(--ui-muted, #b2c6c3)', fontSize: 12 }}>
        {place.coordinates[1].toFixed(6)}, {place.coordinates[0].toFixed(6)} · WGS84
      </div>
      {incoming.parsed?.kind === 'place' && incoming.parsed.inputDatum === 'GCJ-02' &&
        <div style={{ marginTop: 3, color: 'var(--ui-muted, #b2c6c3)', fontSize: 12 }}>腾讯坐标已转换为 WGS84</div>}
      <div style={{ marginTop: 5, color: 'var(--ui-muted, #c2d6d0)', fontSize: 12 }}>{automatic
        ? saved ? '同名标记已保存到收藏，可在山兔规划路线。' : failedSave ? '标记尚未保存，请重试。' : '正在保存同名标记…'
        : '导航会保存同名标记并设为路线终点，确认路线后再开始。'}</div>
    </> : <div role={incoming.resolving ? 'status' : undefined} style={{ color: 'var(--ui-muted, #c2d6d0)' }}>{incoming.resolving ? '正在联网展开地点链接，完成后自动生成标记。' : unsupportedReason}</div>}
    </div>
    {saveAttempted && !saved && saveError && <p role="alert" style={{ color: 'var(--ui-danger)', margin: '4px 0', fontSize: 12 }}>{saveError}</p>}
    <div style={{ display: 'flex', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4, marginTop: 4 }}>
      <button type="button" onClick={() => dismiss(incoming.token)} style={buttonStyle(false)}>关闭</button>
      {incoming.retryable && <button type="button" onClick={() => nativeBridge()?.incomingPlaceRetry?.(incoming.token)} style={buttonStyle(false)}>重试读取</button>}
      {failedSave && <button type="button" onClick={() => saveGoogle(incoming, true)} style={buttonStyle(false)}>重试保存</button>}
      {place && !automatic && onSave && <button type="button" onClick={() => { setSaveAttempted(true); if (onSave(place)) dismiss(incoming.token, false); }} style={buttonStyle(false)}>保存标记</button>}
      {place && <button type="button" onClick={() => {
        const selected = place;
        setSaveAttempted(true);
        if (onNavigate(selected) !== false) dismiss(incoming.token, false);
      }} disabled={automatic && !saved} style={{ ...buttonStyle(true), opacity: automatic && !saved ? .5 : 1 }}>在山兔导航</button>}
    </div>
  </section>;
}

function buttonStyle(primary: boolean): CSSProperties {
  return {
    minHeight: 44, padding: '0 12px', borderRadius: 4,
    border: primary ? '1px solid var(--ui-accent, #d0f76b)' : '1px solid var(--ui-line, rgba(208,228,221,.3))',
    color: primary ? 'var(--ui-on-accent, #10243c)' : 'var(--ui-button-ink, var(--ui-ink, #f2f5ed))',
    background: primary ? 'var(--ui-accent, #d0f76b)' : 'var(--ui-raised, #252e2b)',
    font: 'inherit', fontWeight: primary ? 650 : 500, cursor: 'pointer',
  };
}
