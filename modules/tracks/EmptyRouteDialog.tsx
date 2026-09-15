import { useRouteDialogFocus } from './useRouteDialogFocus';
export function EmptyRouteDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const root = useRouteDialogFocus(onCancel);
  return (
    <div className="route-window-backdrop route-unsaved-backdrop">
      <section
        ref={root}
        className="route-surface route-unsaved"
        role="alertdialog"
        aria-modal="true"
        aria-label="确认清空路线"
      >
        <strong>已移除全部路线点</strong>
        <p>
          确认保存空路线？此路线存档将移除，其他分支来源、行程、标记和照片保留。
        </p>
        <button onClick={onCancel}>返回编辑</button>
        <button onClick={onConfirm}>确认清空</button>
      </section>
    </div>
  );
}
