'use client';

import { useEffect } from 'react';
import { OPEN_LAYOUT_EDITOR } from './events';
import { createSession } from './session.mjs';
import { bindLayoutActions, downloadLayout } from './transfer.mjs';
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
    const start = async () => {
      if (closing || loading) return;
      loading = true;
      try {
        const { mountEditor } = await import('./mobileEditor.mjs');
        if (!disposed) {
          closing = mountEditor(session, () => {
            closing = undefined;
          });
        }
      } finally {
        loading = false;
      }
    };
    const unbind = bindLayoutActions(window, {
      edit: async () => {
        await start();
        return '布局调节已打开';
      },
      export: () => downloadLayout(session.layout),
      import: (raw: string) => {
        session.import(raw);
        if (!session.save()) {
          session.cancel();
          throw Error('保存失败，已保留原布局');
        }
        return '布局已导入并保存，可继续调整';
      },
    });
    window.addEventListener(OPEN_LAYOUT_EDITOR, start);
    return () => {
      disposed = true;
      window.removeEventListener(OPEN_LAYOUT_EDITOR, start);
      closing?.();
      unbind();
      session.dispose();
    };
  }, []);
  return null;
}
