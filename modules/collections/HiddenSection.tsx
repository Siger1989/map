import { useState } from 'react';
import type { SectionObject } from '../section/sectionObjects';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
import { collectData } from '../outdoor/exchange';
import { saveWorkbench } from './workbenchStore';
import { visibilityTransfer } from './hidden';
export function HiddenSection({
  item,
  onBack,
  onRestore,
}: {
  item: SectionObject;
  onBack: () => void;
  onRestore: () => void;
}) {
  const root = useRouteDialogFocus(onBack),
    [error, setError] = useState(''),
    s = item.settings;
  return (
    <section
      ref={root}
      className="trip-details route-surface"
      role="dialog"
      aria-label="隐藏剖面详情"
    >
      <header>
        <button onClick={onBack}>返回收藏</button>
        <strong>{item.name}</strong>
      </header>
      <div className="trip-detail-scroll">
        <p>已隐藏 · {s.survey ? '测线剖面' : '三维剖面'}</p>
        <p>
          基准海拔 {s.altitude} m
          {s.plane && ` · 宽 ${s.plane.width} m · 高 ${s.plane.height} m`}
        </p>
        <button
          onClick={() => {
            try {
              const before = collectData();
              saveWorkbench(
                before,
                visibilityTransfer(before, ['section:' + item.id], true),
              );
              onRestore();
            } catch (e) {
              setError(e instanceof Error ? e.message : '恢复失败');
            }
          }}
        >
          恢复显示
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
    </section>
  );
}
