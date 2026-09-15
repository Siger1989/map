'use client';
import { useEffect } from 'react';
import { bindLayoutActions, downloadLayout } from './transfer.mjs';
import { emptyLayout, validateLayout } from './model.mjs';
import { STORAGE_KEY } from './session.mjs';
/** Fixed map layout; retain the user's old layout archive as a transferable backup. */
export function LayoutCustomization() {
  useEffect(
    () =>
      bindLayoutActions(window, {
        edit: () => '当前使用固定地图布局',
        export: () =>
          downloadLayout(
            validateLayout(
              JSON.parse(
                localStorage.getItem(STORAGE_KEY) ??
                  JSON.stringify(emptyLayout()),
              ),
            ),
          ),
        import: (raw: string) => {
          const value = JSON.stringify(validateLayout(JSON.parse(raw)));
          localStorage.setItem(STORAGE_KEY, value);
          if (localStorage.getItem(STORAGE_KEY) !== value)
            throw new Error('布局备份未保存');
          return '布局备份已导入';
        },
      }),
    [],
  );
  return null;
}
