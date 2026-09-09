import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Check,
  Bookmark,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MapPin,
  MoreHorizontal,
  Route,
  Trash2,
  X,
} from 'lucide-react';
import { folderTheme } from './folderTheme';
import { deliverFile } from '../files/delivery';
import { useSwipeSelection } from './useSwipeSelection';
import { useWorkbenchLongPress } from './useWorkbenchLongPress';
import {
  WorkbenchSort,
  WORKBENCH_SORTS,
  workbenchDistance,
  sortWorkbenchItems,
  type WorkbenchSortOrder,
} from './WorkbenchSort';
import { workbenchShareIds } from './workbenchShareData';
import {
  WorkbenchAction,
  type WorkbenchActionType,
} from './WorkbenchAction';
import {
  dropWorkbenchItems,
  dissolveWorkbenchFolder,
  flattenWorkbench,
  moveWorkbenchItems,
  workbenchDetails,
  workbenchLeaves,
  workbenchRegionTree,
  removeWorkbenchItems,
  updateWorkbenchItem,
  type WorkbenchItem,
} from './workbenchTree';
import './workbench.css';
import './workbenchLayout.css';
import { useWorkbenchData } from './useWorkbenchData';
import { catalogEntries } from './catalog';
import { collectionTransfer } from './export';
import { selectedWorkbenchKeys } from './workbenchShareData';

const TYPES = [
  ['all', '全部'],
  ['route', '路线'],
  ['track', '轨迹'],
  ['pin', '标记'],
  ['model', '模型'],
  ['area', '区域'],
  ['section', '剖面'],
];
type Props = {
  center: [number, number];
  onClose: () => void;
  onLocate: (key: string) => void;
  onOpen: (key: string) => void;
  onNavigate: (key: string) => void;
  onManage: (keys?: string[]) => void;
};
export function WorkbenchPanel(props: Props) {
  const store = useWorkbenchData();
  const items = useMemo(() => store.items, [store.data]);
  const [expanded, setExpanded] = useState(new Set<string>(['unfiled']));
  const [query, setQuery] = useState(''),
    [type, setType] = useState('all'),
    [regionMode, setRegionMode] = useState(false);
  const [sort, setSort] = useState<WorkbenchSortOrder>('manual'),
    [sortCenter, setSortCenter] = useState<[number, number]>(props.center);
  const center = useRef<[number, number]>(props.center);
  const [batch, setBatch] = useState(false),
    [checked, setChecked] = useState(new Set<string>()),
    [active, setActive] = useState('');
  const [action, setAction] = useState<WorkbenchActionType | null>(null),
    [message, setMessage] = useState(''),
    [actionMessage, setActionMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const visibleAction = useMemo(
    () =>
      action?.type === 'share' && batch
        ? { ...action, ids: workbenchShareIds(action.ids, [...checked]) }
        : action,
    [action, batch, checked],
  );
  center.current = props.center;
  const filtered = type !== 'all' || !!query.trim();
  const view = useMemo(() => {
    const source = regionMode ? workbenchRegionTree(items) : items;
    const match = (i: WorkbenchItem) =>
      `${i.name} ${workbenchDetails(i)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()) &&
      (type === 'all' || i.kind === type);
    const filter = (list: WorkbenchItem[]): WorkbenchItem[] =>
      list.flatMap((i) => {
        if (i.kind !== 'folder') return match(i) ? [i] : [];
        const children = filter(i.children ?? []);
        return children.length || !filtered ? [{ ...i, children }] : [];
      });
    return filter(source);
  }, [items, regionMode, type, query, filtered]);
  const nodes = useMemo(() => {
    const result = new Map<string, WorkbenchItem>();
    const visit = (list: WorkbenchItem[], parent = '') =>
      list.forEach((i) => {
        const key = parent ? `${parent}/${i.id}` : i.id;
        result.set(key, i);
        visit(i.children ?? [], key);
      });
    visit(view);
    return result;
  }, [view]);
  const preview = nodes.get(active) ?? null;
  const currentKeys = batch
    ? [...checked]
    : preview
      ? preview.kind === 'folder' && (regionMode || preview.id === 'unfiled')
        ? workbenchLeaves(preview.children ?? []).map((i) => i.id)
        : [preview.id]
      : [];
  const showAction = (next: WorkbenchActionType) => {
    setActionMessage('');
    if (next.type === 'share') {
      const ids = workbenchShareIds(next.ids, batch ? [...checked] : undefined);
      if (!ids.length) {
        setActionMessage('请先勾选要分享的收藏。');
        return;
      }
      setAction({ ...next, ids });
    } else setAction(next);
  };
  const commit = (next: WorkbenchItem[], text: string) => {
    const ok = store.commit(next);
    if (ok) { setMessage(text); setActionMessage(''); }
    return ok;
  };
  const toggle = (ids: string[]) =>
    setChecked((old) => {
      const next = new Set(old),
        remove = ids.every((id) => old.has(id));
      ids.forEach((id) => (remove ? next.delete(id) : next.add(id)));
      return next;
    });
  const swipe = useSwipeSelection((keys, selected) =>
    setChecked((old) => {
      const next = new Set(old);
      for (const key of keys) {
        const item = nodes.get(key);
        if (!item) continue;
        for (const id of item.kind === 'folder'
          ? workbenchLeaves(item.children ?? []).map((i) => i.id)
          : [item.id])
          selected ? next.add(id) : next.delete(id);
      }
      return next;
    }),
  );
  const hold = useWorkbenchLongPress(swipe.list, (ids, target) => {
    try {
      if (
        commit(
          dropWorkbenchItems(items, new Set(ids), target.id, target.position),
          target.position === 'inside'
            ? `已移入 ${target.name}`
            : '已调整排列位置',
        )
      )
        setSort('manual');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '移动失败，请重试');
    }
  });
  const startBatch = (ids: string[]) => {
    setChecked(new Set(ids));
    setBatch(true);
    setAction(null);
  };
  const selectedTransfer = (ids: string[]) => {
    const keys = new Set(selectedWorkbenchKeys(items, ids));
    if (!store.data || !keys.size) throw new Error('请先选择要分享的收藏');
    return collectionTransfer(catalogEntries(store.data.favorites, store.data.tracks, store.data.annotations, store.data.sections ?? [], store.data.areas ?? []).filter(e => keys.has(e.key)), store.data.regions ?? {}, localStorage);
  };
  const share = async (ids: string[], send: boolean) => {
    setBusy(true);
    setActionMessage('');
    try {
      const file = new File(
        [JSON.stringify(selectedTransfer(ids), null, 2)],
        `Shantu-collection-${Date.now()}.json`,
        { type: 'application/json' },
      );
      const fallback =
        send &&
        !window.GuanyunNative &&
        !navigator.canShare?.({ files: [file] });
      const result = await deliverFile(file, send && !fallback);
      setActionMessage(
        fallback
          ? '当前浏览器不支持系统分享，已请求保存文件；也可复制 JSON 内容。'
          : !send
            ? '已请求保存文件。若浏览器未提供下载，可复制 JSON 内容。'
            : result,
      );
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : '分享失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  const copy = async (ids: string[]) => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(selectedTransfer(ids), null, 2),
      );
      setActionMessage('已复制 JSON 内容，可保存为 .json 文件后导入山兔。');
    } catch {
      setActionMessage('复制失败，请使用系统分享或保存文件。');
    }
  };
  const row = (item: WorkbenchItem, depth = 0, parent = ''): React.ReactNode => {
    const key = parent ? `${parent}/${item.id}` : item.id,
      folder = item.kind === 'folder',
      synthetic = item.id.startsWith('region:');
    const ids = folder
      ? workbenchLeaves(item.children ?? []).map((i) => i.id)
      : [item.id];
    const selectedCount = ids.filter((id) => checked.has(id)).length,
      complete = !!ids.length && selectedCount === ids.length;
    const open = expanded.has(item.id) || !!query;
    const check = batch && (
      <button
        className="workbench-check"
        role="checkbox"
        data-select-key={key}
        aria-label={`选择 ${item.name}`}
        aria-checked={complete ? true : selectedCount ? 'mixed' : false}
        disabled={!ids.length}
        onPointerDown={(e) => swipe.start(e, !complete)}
        onClick={(e) => {
          if (e.detail === 0) toggle(ids);
        }}
      >
        <span>{complete ? <Check size={14} /> : selectedCount ? '−' : ''}</span>
      </button>
    );
    const controls = (
      <>
        {check}
        <button
          className="workbench-item-open"
          aria-label={`${folder ? '展开文件夹' : '定位收藏'} ${item.name}`}
          aria-expanded={folder ? open : undefined}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (!synthetic && item.id !== 'unfiled')
              hold.start(
                e,
                batch && checked.has(item.id)
                  ? [...checked]
                  : regionMode && folder
                    ? ids
                    : [item.id],
                item.name,
              );
          }}
          onClick={() => {
            if (hold.suppressClick()) return;
            setActive(key);
            if (folder)
              setExpanded((old) => {
                const next = new Set(old);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            else props.onLocate(item.id);
          }}
        >
          {folder ? (
            open ? (
              <ChevronDown size={13} />
            ) : (
              <ChevronRight size={13} />
            )
          ) : null}
          {folder ? (
            <Folder size={16} />
          ) : item.kind === 'pin' ? (
            <MapPin size={16} color={item.color} />
          ) : (
            <Route size={16} color={item.color} />
          )}
          <span>
            <strong>{item.name}</strong>
            <small>
              {folder
                ? `${ids.length} 项`
                : sort === 'newest' || sort === 'oldest'
                  ? `${(item.createdAt == null ? '时间未记录' : new Date(item.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }))} · ${workbenchDetails(item)}`
                  : sort === 'nearest' || sort === 'farthest'
                    ? `${Math.round(workbenchDistance(item, sortCenter)!)} m · ${workbenchDetails(item)}`
                    : workbenchDetails(item)}
            </small>
          </span>
        </button>
        {!synthetic && (
          <button
            className="workbench-item-more"
            aria-label={`操作 ${item.name}`}
            onClick={() =>
              showAction({
                type: 'menu',
                id: item.id,
                ...(regionMode && folder ? { scopedIds: ids } : {}),
              })
            }
          >
            <MoreHorizontal size={17} />
          </button>
        )}
      </>
    );
    const style = {
      '--tree-depth': Math.min(depth, 5),
      ...(folder ? folderTheme(item.color) : {}),
    } as CSSProperties;
    const dropAttrs = {
      'data-workbench-drop': synthetic ? undefined : item.id,
      'data-drop-name': item.name,
      'data-drop-folder': String(folder),
      'data-drop-open': String(open),
      'data-drop-position':
        hold.drag?.target?.id === item.id
          ? hold.drag.target.position
          : undefined,
    };
    if (!folder)
      return (
        <div
          key={key}
          {...dropAttrs}
          style={style}
          className={`workbench-tree-item${active === key ? ' is-active' : ''}${complete ? ' is-checked' : ''}`}
        >
          {controls}
        </div>
      );
    return (
      <div key={key} className="workbench-tree-folder" style={style}>
        <div
          {...dropAttrs}
          className={`workbench-folder-heading${active === key ? ' is-active' : ''}${complete ? ' is-checked' : ''}`}
        >
          {controls}
        </div>
        {open && (
          <div>
            {item.children?.length ? (
              sortWorkbenchItems(item.children, sort, sortCenter).map((i) =>
                row(i, depth + 1, key),
              )
            ) : (
              <p className="workbench-empty">暂无收藏</p>
            )}
          </div>
        )}
      </div>
    );
  };
  const visibleKeys = workbenchLeaves(view).map((i) => i.id);
  return (
    <div className="collection-workbench">
      <div className="workbench-split">
        <section
          className="workbench-collections"
          aria-label="上方收藏列表"
        >
          <header className="workbench-heading">
            <img src="/brand/shantu-logo.png" alt="山兔" />
            <div>
              <strong>收藏</strong>
              <small>
                {batch
                  ? `已选 ${checked.size} 项`
                  : `${workbenchLeaves(items).length} 项`}
              </small>
            </div>
            <button
              aria-label={batch ? '完成多选' : '进入多选'}
              aria-pressed={batch}
              onClick={() => {
                setBatch(!batch);
                setChecked(new Set());
              }}
            >
              {batch ? '完成' : '多选'}
            </button>
            <button
              className="workbench-delete"
              aria-label="删除选中收藏"
              disabled={!currentKeys.length}
              onClick={() => showAction({ type: 'delete', ids: currentKeys })}
            >
              <Trash2 size={18} />
            </button>
            <button
              className="workbench-close"
              aria-label="关闭收藏"
              onClick={() => {
                setAction(null);
                props.onClose();
              }}
            >
              <X size={15} />
              关闭
            </button>
          </header>
          <div className="workbench-search">
            <input
              aria-label="搜索收藏"
              placeholder="搜索收藏"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <WorkbenchSort
              value={sort}
              onChange={(value) => {
                setSort(value);
                setSortCenter(center.current);
              }}
            />
            <button
              aria-label="新建文件夹"
              title="新建文件夹"
              onClick={() => showAction({ type: 'new' })}
            >
              <FolderPlus size={19} />
            </button>
            <button
              aria-label="收藏主菜单"
              onClick={() =>
                showAction({
                  type: 'menu',
                  scopedIds: batch ? [...checked] : undefined,
                })
              }
            >
              <MoreHorizontal size={19} />
            </button>
          </div>
          <nav className="workbench-tags" aria-label="收藏分类">
            <button
              aria-pressed={regionMode}
              onClick={() => {
                setRegionMode(!regionMode);
                setActive('');
              }}
            >
              地区
            </button>
            {TYPES.map(([id, label]) => (
              <button
                key={id}
                aria-pressed={type === id}
                onClick={() => setType(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          {sort !== 'manual' && (
            <div className="workbench-sort-label">
              {WORKBENCH_SORTS.find((s) => s.id === sort)!.detail}
              {sort === 'nearest' || sort === 'farthest' ? ' · 地图中心' : ''}
            </div>
          )}
          <div ref={swipe.list} className="workbench-tree-list">
            {sortWorkbenchItems(view, sort, sortCenter).map((i) => row(i))}
            {!view.length && <p className="workbench-empty">没有匹配的收藏</p>}
          </div>
          {batch && (
            <div className="workbench-batch">
              <button
                disabled={!checked.size}
                onClick={() => showAction({ type: 'share', ids: [...checked] })}
              >
                分享
              </button>
              <button
                disabled={!checked.size}
                onClick={() => showAction({ type: 'move', ids: [...checked] })}
              >
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
          )}
          {(message || store.error) && (
            <div className="workbench-status" role="status">
              <span>{store.error || message}</span>
              {store.canUndo && (
                <button
                  onClick={() => {
                    if (store.restore()) setMessage('已撤销上次修改');
                  }}
                >
                  撤销
                </button>
              )}
            </div>
          )}
        </section>
      </div>
      {hold.drag && (
        <div
          className="workbench-drag-cursor"
          role="status"
          style={{
            left: Math.max(
              8,
              Math.min(hold.drag.x + 12, window.innerWidth - 180),
            ),
            top: Math.max(
              8,
              Math.min(hold.drag.y + 18, window.innerHeight - 70),
            ),
          }}
        >
          <strong>
            {(() => {
              const i = flattenWorkbench(items).find(
                (i) => i.id === hold.drag!.ids[0],
              );
              return i?.kind === 'pin' ? (
                <MapPin size={20} color={i.color} />
              ) : i?.kind === 'folder' ? (
                <Folder size={20} />
              ) : (
                <Route size={20} />
              );
            })()}
            {hold.drag.ids.length > 1
              ? `${hold.drag.ids.length} 项`
              : hold.drag.label}
          </strong>
          <span>
            {hold.drag.target
              ? `${hold.drag.target.position === 'inside' ? '移入' : hold.drag.target.position === 'before' ? '放到上方' : '放到下方'} · ${hold.drag.target.name}`
              : '移到文件夹或插入线 · 移出列表取消'}
          </span>
        </div>
      )}
      {visibleAction && (
        <WorkbenchAction
          key={JSON.stringify(visibleAction)}
          action={visibleAction}
          items={items}
          error={actionMessage || store.error}
          busy={busy}
          onClose={() => setAction(null)}
          onAction={showAction}
          onBatch={startBatch}
          onOpen={props.onOpen}
          onNavigate={props.onNavigate}
          onManage={props.onManage}
          onShare={share}
          onCopy={copy}
          onEdit={(id, patch) =>
            commit(updateWorkbenchItem(items, id, patch), '已保存名称与颜色')
          }
          onNew={(name, color, parent) => {
            const item: WorkbenchItem = {
              id: crypto.randomUUID(),
              kind: 'folder',
              name,
              color,
              children: [],
            };
            const target = flattenWorkbench(items).find((i) => i.id === parent);
            return commit(
              target
                ? updateWorkbenchItem(items, parent, {
                    children: [...(target.children ?? []), item],
                  })
                : [...items, item],
              '文件夹已创建',
            );
          }}
          onMove={(ids, target) => {
            try {
              return commit(
                moveWorkbenchItems(items, new Set(ids), target),
                '已移动到所选文件夹',
              );
            } catch (e) {
              setActionMessage(e instanceof Error ? e.message : '移动失败');
              return false;
            }
          }}
          onDelete={(ids) => {
            const ok = commit(
              removeWorkbenchItems(items, new Set(ids)),
              '所选收藏已删除',
            );
            if (ok) {
              setChecked(new Set());
              setActive('');
            }
            return ok;
          }}
          onDissolve={(id) => {
            try {
              const ok = commit(
                dissolveWorkbenchFolder(items, id),
                '已解散文件夹，全部收藏内容保留',
              );
              if (ok) setActive('');
              return ok;
            } catch (e) {
              setActionMessage(e instanceof Error ? e.message : '解散失败');
              return false;
            }
          }}
        />
      )}
    </div>
  );
}
