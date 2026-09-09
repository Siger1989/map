import { createPortal } from 'react-dom';
import { SmartInput } from '../input/SmartText';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { WorkbenchShare } from './WorkbenchShare';
import {
  flattenWorkbench,
  workbenchLeaves,
  type WorkbenchItem,
} from './workbenchTree';

export type WorkbenchActionType =
  | { type: 'menu'; id?: string; scopedIds?: string[] }
  | { type: 'edit' | 'new'; id?: string; parentId?: string }
  | { type: 'dissolve'; id: string }
  | { type: 'move' | 'delete' | 'share'; ids: string[] };
type Props = {
  action: WorkbenchActionType;
  items: WorkbenchItem[];
  onClose: () => void;
  onAction: (action: WorkbenchActionType) => void;
  onEdit: (id: string, patch: Partial<WorkbenchItem>) => boolean;
  onNew: (name: string, color: string, parent: string) => boolean;
  onMove: (ids: string[], destination: string) => boolean;
  onDelete: (ids: string[]) => boolean;
  onDissolve: (id: string) => boolean;
  onShare: (ids: string[], send: boolean) => Promise<void>;
  onCopy: (ids: string[]) => Promise<void>;
  onBatch: (ids: string[]) => void;
  onOpen: (key: string) => void;
  onNavigate: (key: string) => void;
  onManage: (keys?: string[]) => void;
  error: string;
  busy: boolean;
};

export function WorkbenchAction(p: Props) {
  const all = flattenWorkbench(p.items),
    itemId = 'id' in p.action ? p.action.id : undefined,
    item = all.find((i) => i.id === itemId);
  const folderPaths = new Map<string, string>();
  const visitFolders = (list: WorkbenchItem[], parent = '') =>
    list.forEach((i) => {
      if (i.kind === 'folder') {
        const path = parent ? `${parent} / ${i.name}` : i.name;
        folderPaths.set(i.id, path);
        visitFolders(i.children ?? [], path);
      }
    });
  visitFolders(p.items);
  const [name, setName] = useState(item?.name ?? ''),
    [color, setColor] = useState(item?.color ?? '#d5e4d9'),
    [destination, setDestination] = useState('unfiled');
  const [parent, setParent] = useState(
    p.action.type === 'new' ? (p.action.parentId ?? '') : '',
  );
  const root = useRef<HTMLElement>(null),
    oldFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    oldFocus.current = document.activeElement as HTMLElement;
    root.current?.querySelector<HTMLInputElement>('input')?.focus();
    if (!root.current?.contains(document.activeElement))
      root.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (oldFocus.current?.isConnected)
        oldFocus.current.focus({ preventScroll: true });
    };
  }, []);
  const ids = 'ids' in p.action ? p.action.ids : item ? [item.id] : [];
  const selected = all.filter((i) => ids.includes(i.id));
  const count = new Set(
    selected
      .flatMap((i) =>
        i.kind === 'folder' ? workbenchLeaves(i.children ?? []) : [i],
      )
      .map((i) => i.id),
  ).size;
  let title = '收藏操作',
    body: ReactNode;
  if (p.action.type === 'menu') {
    const keys =
      p.action.scopedIds ??
      (item ? [item.id] : workbenchLeaves(p.items).map((i) => i.id));
    title = item?.name ?? '收藏管理';
    body = (
      <div className="collection-action-buttons">
        {item && item.kind !== 'folder' && (
          <button onClick={() => p.onOpen(item.id)}>打开 / 编辑详情</button>
        )}
        {item && (item.kind === 'track' || item.kind === 'route') && (
          <button onClick={() => p.onNavigate(item.id)}>开始导航</button>
        )}
        {item && (
          <button onClick={() => p.onAction({ type: 'edit', id: item.id })}>
            {item.kind === 'route' || item.kind === 'section'
              ? '重命名'
              : '重命名 / 颜色'}
          </button>
        )}
        {(!item || item.kind === 'folder') && item?.id !== 'unfiled' && (
          <button
            onClick={() => p.onAction({ type: 'new', parentId: item?.id })}
          >
            {item ? '新建子文件夹' : '新建文件夹'}
          </button>
        )}
        <button
          disabled={!keys.length}
          onClick={() =>
            p.onBatch(
              p.action.type === 'menu' && p.action.scopedIds
                ? p.action.scopedIds
                : item?.kind === 'folder'
                  ? workbenchLeaves(item.children ?? []).map((i) => i.id)
                  : keys,
            )
          }
        >
          选择 / 多选
        </button>
        <button
          disabled={
            !keys.length ||
            (!!item &&
              item.kind === 'folder' &&
              !workbenchLeaves(item.children ?? []).length)
          }
          onClick={() => p.onAction({ type: 'share', ids: keys })}
        >
          分享 / 导出
        </button>
        {item && item.id !== 'unfiled' && (
          <button onClick={() => p.onAction({ type: 'move', ids: keys })}>
            移动到文件夹
          </button>
        )}
        <button onClick={() => p.onManage(keys)}>地区编辑 / ZIP / Excel</button>
        {item?.kind === 'folder' && item.id !== 'unfiled' && (
          <button onClick={() => p.onAction({ type: 'dissolve', id: item.id })}>
            解散文件夹（保留内容）
          </button>
        )}
        {item && item.id !== 'unfiled' && (
          <button
            className="collection-action-danger"
            onClick={() => p.onAction({ type: 'delete', ids: keys })}
          >
            删除
            {p.action.scopedIds
              ? '当前地区条目'
              : item.kind === 'folder'
                ? '文件夹及内容'
                : '条目'}
            …
          </button>
        )}
      </div>
    );
  } else if (p.action.type === 'dissolve') {
    title = `解散「${item!.name}」？`;
    const parent = all.find((i) => i.children?.some((c) => c.id === item!.id));
    body = (
      <>
        <p>保留全部 {count} 个收藏，只移除这一层文件夹。</p>
        <p>
          {parent
            ? `内容移入「${folderPaths.get(parent.id)}」。`
            : '条目移入「未分组」，子文件夹保留在收藏根目录。'}
          同一文件夹在各地区的分组会一起解除，收藏内容均保留。
        </p>
        <div className="collection-action-pair">
          <button onClick={p.onClose}>取消</button>
          <button
            className="collection-action-primary"
            onClick={() => {
              if (p.onDissolve(item!.id)) p.onClose();
            }}
          >
            解散并保留内容
          </button>
        </div>
      </>
    );
  } else if (p.action.type === 'edit' || p.action.type === 'new') {
    title = p.action.type === 'new' ? '新建文件夹' : '名称与颜色';
    body = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const ok =
            p.action.type === 'new'
              ? p.onNew(name.trim(), color, parent)
              : p.onEdit(item!.id, { name: name.trim(), color });
          if (ok) p.onClose();
        }}
      >
        <label>
          名称
          <SmartInput
            aria-label="收藏名称"
            required
            maxLength={30}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {p.action.type === 'new' && (
          <label>
            放在
            <select
              aria-label="新文件夹位置"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              <option value="">收藏根目录</option>
              {[...folderPaths]
                .filter(([id]) => id !== 'unfiled')
                .map(([id, path]) => (
                  <option key={id} value={id}>
                    {path}
                  </option>
                ))}
            </select>
          </label>
        )}
        {item?.kind !== 'route' && item?.kind !== 'section' && (
          <label className="collection-action-color">
            {item?.kind === 'folder' || p.action.type === 'new'
              ? '文件夹区域底色'
              : '标记 / 路线颜色'}
            <input
              aria-label="收藏颜色"
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
        )}
        <button
          type="submit"
          className="collection-action-primary"
          disabled={!name.trim()}
        >
          保存
        </button>
      </form>
    );
  } else if (p.action.type === 'move') {
    title = `移动 ${selected.length} 项`;
    const forbidden = new Set(
      selected.flatMap((i) => [
        i.id,
        ...flattenWorkbench(i.children ?? []).map((c) => c.id),
      ]),
    );
    const folders = all.filter(
      (i) => i.kind === 'folder' && !forbidden.has(i.id),
    );
    body = (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (p.onMove(ids, destination)) p.onClose();
        }}
      >
        <label>
          目标文件夹
          <select
            aria-label="目标文件夹"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          >
            {selected.every((i) => i.kind === 'folder') && (
              <option value="">收藏根目录</option>
            )}
            {folders.map((i) => (
              <option key={i.id} value={i.id}>
                {folderPaths.get(i.id)}
              </option>
            ))}
          </select>
        </label>
        <p>可混合放入路线、轨迹和标记。地区归属随地点保留。</p>
        <button
          type="submit"
          className="collection-action-primary"
          disabled={
            !(
              destination === '' && selected.every((i) => i.kind === 'folder')
            ) && !folders.some((i) => i.id === destination)
          }
        >
          确认移动
        </button>
      </form>
    );
  } else if (p.action.type === 'delete') {
    title = `删除 ${count} 个收藏${selected.some((i) => i.kind === 'folder') ? '及所选文件夹' : ''}？`;
    body = (
      <>
        <p>将删除本次选中的项目。删除后可用底部“撤销”恢复。</p>
        <ul>
          {selected.slice(0, 8).map((i) => (
            <li key={i.id}>{i.name}</li>
          ))}
        </ul>
        {selected.length > 8 && <p>另有 {selected.length - 8} 项</p>}
        <div className="collection-action-pair">
          <button onClick={p.onClose}>取消</button>
          <button
            className="collection-action-danger"
            onClick={() => {
              if (p.onDelete(ids)) p.onClose();
            }}
          >
            确认删除
          </button>
        </div>
      </>
    );
  } else {
    title = `分享 ${count} 项`;
    body = (
      <WorkbenchShare
        items={p.items}
        ids={ids}
        busy={p.busy}
        onShare={p.onShare}
        onCopy={p.onCopy}
      />
    );
  }
  return createPortal(
    <div className="collection-workbench collection-modal-root">
      <div
        className="collection-action-backdrop"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget && !p.busy) p.onClose();
        }}
      >
        <section
          ref={root}
          className="collection-action-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !p.busy) {
              e.preventDefault();
              e.stopPropagation();
              p.onClose();
            }
            if (e.key === 'Tab') {
              const nodes = Array.from(
                root.current?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]',
                ) ?? [],
              );
              if (e.shiftKey && document.activeElement === nodes[0]) {
                e.preventDefault();
                nodes.at(-1)?.focus();
              } else if (
                !e.shiftKey &&
                document.activeElement === nodes.at(-1)
              ) {
                e.preventDefault();
                nodes[0]?.focus();
              }
            }
          }}
        >
          <header>
            <strong>{title}</strong>
            <button
              aria-label="关闭收藏操作"
              disabled={p.busy}
              onClick={p.onClose}
            >
              <X size={18} />
            </button>
          </header>
          <div className="collection-action-content">
            {body}
            {p.error && (
              <p className="collection-action-error" role="status">
                {p.error}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
}
