'use client';

import { useEffect } from 'react';
import { OPEN_LAYOUT_EDITOR } from './events';
import { createSession } from './session.mjs';
import './uiLayout.css';

/** A sibling of the map: no access to map state, storage or geometry. */
export function LayoutCustomization() {
  useEffect(() => {
    // The desktop controller owns the iframe's temporary layout independently.
    if (window.parent !== window) {
      try {
        if (window.parent.location.pathname.startsWith('/__layout')) return;
      } catch {
        /* Other embedding. */
      }
    }
    const session = createSession(document, window.localStorage);
    let disposed = false,
      closing: (() => void) | undefined,
      loading = false;
    const recovery = document.createElement('button');
    recovery.className = 'layout-recovery';
    recovery.dataset.layoutIgnore = '';
    recovery.textContent = '布局';
    recovery.setAttribute('aria-label', '调整或恢复已保存布局');
    document.body.appendChild(recovery);
    const visibility = () => {
      recovery.hidden = !session.layout.entries.length || !!closing;
    };
    const start = async () => {
      if (closing || loading) return;
      loading = true;
      try {
        const { mountEditor } = await import('./mobileEditor.mjs');
        if (!disposed) {
          closing = mountEditor(session, () => {
            closing = undefined;
            visibility();
          });
          visibility();
        }
      } finally {
        loading = false;
      }
    };
    recovery.onclick = start;
    visibility();
    window.addEventListener(OPEN_LAYOUT_EDITOR, start);
    return () => {
      disposed = true;
      window.removeEventListener(OPEN_LAYOUT_EDITOR, start);
      closing?.();
      recovery.remove();
      session.dispose();
    };
  }, []);
  return null;
}
