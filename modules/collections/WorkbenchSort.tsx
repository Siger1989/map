import { useEffect, useRef, useState } from 'react';
import { ArrowDownWideNarrow, Check, X } from 'lucide-react';

export const WORKBENCH_SORTS = [
  {
    id: 'manual',
    label: '自定义顺序',
    detail: '保留原来的排列',
    short: '排序',
  },
  { id: 'newest', label: '时间', detail: '最新在前', short: '时间' },
  { id: 'oldest', label: '时间', detail: '最早在前', short: '时间' },
  { id: 'nearest', label: '距离', detail: '从近到远', short: '距离' },
  { id: 'farthest', label: '距离', detail: '从远到近', short: '距离' },
  { id: 'kind', label: '种类', detail: '同类排列在一起', short: '种类' },
] as const;
export type WorkbenchSortOrder = (typeof WORKBENCH_SORTS)[number]['id'];
export type WorkbenchSortOrderable = {
  kind: string;
  createdAt?: number;
  coordinates?: [number, number];
};
export function workbenchDistance(
  item: WorkbenchSortOrderable,
  center: [number, number],
) {
  if (!item.coordinates) return null;
  const rad = Math.PI / 180,
    [lng, lat] = item.coordinates;
  const a =
    Math.sin(((lat - center[1]) * rad) / 2) ** 2 +
    Math.cos(lat * rad) *
      Math.cos(center[1] * rad) *
      Math.sin(((lng - center[0]) * rad) / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
export function sortWorkbenchItems<T extends WorkbenchSortOrderable>(
  items: T[],
  sort: WorkbenchSortOrder,
  center: [number, number],
): T[] {
  if (sort === 'manual') return items;
  const kinds = ['route', 'track', 'pin', 'model', 'area', 'section'];
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      // Folder order stays stable; only siblings are sorted inside their existing parent.
      if (a.item.kind === 'folder' || b.item.kind === 'folder')
        return a.item.kind === b.item.kind
          ? a.index - b.index
          : a.item.kind === 'folder'
            ? -1
            : 1;
      if (sort === 'kind')
        return (
          kinds.indexOf(a.item.kind) - kinds.indexOf(b.item.kind) ||
          a.index - b.index
        );
      const distance = sort === 'nearest' || sort === 'farthest';
      const av = distance ? workbenchDistance(a.item, center) : a.item.createdAt;
      const bv = distance ? workbenchDistance(b.item, center) : b.item.createdAt;
      if (av == null || bv == null)
        return av == null && bv == null
          ? a.index - b.index
          : av == null
            ? 1
            : -1;
      return (
        (av - bv) * (sort === 'newest' || sort === 'farthest' ? -1 : 1) ||
        a.index - b.index
      );
    })
    .map(({ item }) => item);
}

export function WorkbenchSort({
  value,
  onChange,
}: {
  value: WorkbenchSortOrder;
  onChange: (sort: WorkbenchSortOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    toggle = useRef<HTMLButtonElement>(null);
  const selected = WORKBENCH_SORTS.find((s) => s.id === value)!;
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    };
    root.current
      ?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
      ?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const close = () => {
    setOpen(false);
    toggle.current?.focus({ preventScroll: true });
  };
  return (
    <div
      ref={root}
      className="workbench-sort"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={toggle}
        className="workbench-sort-toggle"
        aria-label={`排序方式：${selected.label}，${selected.detail}`}
        aria-expanded={open}
        aria-controls="workbench-sort-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <ArrowDownWideNarrow size={17} />
        <small>{selected.short}</small>
      </button>
      {open && (
        <section
          className="workbench-sort-menu"
          id="workbench-sort-menu"
          aria-label="选择排序方式"
        >
          <header>
            <strong>排序方式</strong>
            <button aria-label="关闭排序选项" onClick={close}>
              <X size={17} />
            </button>
          </header>
          <div role="radiogroup" aria-label="收藏排序">
            {WORKBENCH_SORTS.map((sort) => (
              <button
                key={sort.id}
                role="radio"
                aria-checked={value === sort.id}
                onClick={() => {
                  onChange(sort.id);
                  close();
                }}
              >
                <span>
                  <strong>{sort.label}</strong>
                  <small>{sort.detail}</small>
                </span>
                {value === sort.id && <Check size={17} />}
              </button>
            ))}
          </div>
          <p>
            时间按收藏时间；距离按排序时地图中心，路线和轨迹取起点。缺少信息的放在最后。
          </p>
        </section>
      )}
    </div>
  );
}
