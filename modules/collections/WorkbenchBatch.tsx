import type { Dispatch, SetStateAction } from 'react';
/** Batch selection actions shared by normal and hidden-folder projections. */
export function WorkbenchBatch({
  checked,
  visibleKeys,
  setChecked,
  onRestore,
  onAction,
}: {
  checked: Set<string>;
  visibleKeys: string[];
  setChecked: Dispatch<SetStateAction<Set<string>>>;
  onRestore: () => void;
  onAction: (type: 'share' | 'move') => void;
}) {
  return (
    <div className="workbench-batch">
      <button disabled={!checked.size} onClick={onRestore}>
        恢复显示
      </button>
      <button disabled={!checked.size} onClick={() => onAction('share')}>
        分享
      </button>
      <button disabled={!checked.size} onClick={() => onAction('move')}>
        移动
      </button>
      <button
        disabled={!visibleKeys.length}
        onClick={() => setChecked(new Set(visibleKeys))}
      >
        全选
      </button>
      <button
        disabled={!visibleKeys.length}
        onClick={() =>
          setChecked((old) => {
            const next = new Set(old);
            visibleKeys.forEach((id) =>
              next.has(id) ? next.delete(id) : next.add(id),
            );
            return next;
          })
        }
      >
        反选
      </button>
    </div>
  );
}
