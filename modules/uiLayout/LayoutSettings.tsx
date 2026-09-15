'use client';
import { useRef, useState } from 'react';
import { requestLayoutAction } from './transfer.mjs';

/** The avatar's settings page shares the active layout session through events. */
export function LayoutSettings() {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('已保留旧布局文件，可导出备份。');
  const run = async (action: string, raw = '') => {
    try {
      setMessage(await requestLayoutAction(action, raw));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '布局操作失败');
    }
  };
  return (
    <section
      className="layout-account-settings"
      aria-label="布局备份"
      data-layout-entry
    >
      <h3>布局备份</h3>
      <div>
        <button onClick={() => void run('export')}>导出布局</button>
        <button onClick={() => file.current?.click()}>导入布局</button>
      </div>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (event) => {
          const input = event.currentTarget,
            chosen = input.files?.[0];
          if (!chosen) return;
          try {
            if (chosen.size > 256 * 1024) throw Error('布局文件不能超过256KB');
            await run('import', await chosen.text());
          } catch (error) {
            setMessage(
              error instanceof Error ? error.message : '无法读取布局文件',
            );
          }
          input.value = '';
        }}
      />
      <p role="status">{message}</p>
    </section>
  );
}
