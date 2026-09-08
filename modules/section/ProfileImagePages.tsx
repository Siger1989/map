import { useState } from 'react';
import { deliverPhoto } from '../photos/export';
/** One native picker per user action; large profiles must never silently drop later pages. */
export function ProfileImagePages({ files }: { files: File[] }) {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  return (
    <section aria-label="剖面图片分页保存">
      <p>共 {files.length} 张，每张都含剖面图和平面地图，数据按页列出。</p>
      <div className="route-edit-actions">
        {files.map((file, i) => (
          <button
            key={file.name}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setNotice(`第 ${i + 1} 张：${await deliverPhoto(file, false)}`);
              } catch (e) {
                setNotice(e instanceof Error ? e.message : '保存失败');
              } finally {
                setBusy(false);
              }
            }}
          >
            保存第 {i + 1} 张
          </button>
        ))}
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
