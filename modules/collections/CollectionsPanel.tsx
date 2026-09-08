import { useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Settings2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import type { RouteFavoritesState } from '../navigation/useRouteFavorites';
import type { ManualTracksState } from '../tracks/useManualTracks';
import type { RouteFavorite } from '../navigation/favorites';
import {
  COLORS,
  UNFILED,
  deleteGroup,
  dropEntry,
  entriesFor,
  groupFor,
  moveEntry,
  orderedEntries,
  reorderGroup,
  type CollectionGroup,
} from './data';
import { useCollections } from './useCollections';
import { useCollectionDrag } from './useCollectionDrag';
import { GroupEditor } from './GroupEditor';
import './collections.css';

const tint = (group: CollectionGroup) =>
  ({ '--collection-color': group.color }) as CSSProperties;
export function CollectionsPanel({
  favorites,
  tracks,
  onRoute,
  onTrack,
  onNavigateRoute,
  onNavigateTrack,
  onShareRoute,
  onShareTrack,
  navigationError,
}: {
  favorites: RouteFavoritesState;
  tracks: ManualTracksState;
  onRoute: (route: RouteFavorite) => void;
  onTrack: (id: string) => void;
  onNavigateRoute: (route: RouteFavorite) => void;
  onNavigateTrack: (id: string) => void;
  onShareRoute: (route: RouteFavorite) => void;
  onShareTrack: (id: string) => void;
  navigationError: string;
}) {
  const c = useCollections(),
    root = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState('all'),
    [view, setView] = useState<'list' | 'groups'>('list');
  const [editing, setEditing] = useState<CollectionGroup | null>(null),
    [itemKey, setItemKey] = useState<string | null>(null);
  const entries = useMemo(
    () => entriesFor(favorites.items, tracks.saved),
    [favorites.items, tracks.saved],
  );
  const all = orderedEntries(c.layout, entries),
    groups = [...c.layout.groups, UNFILED];
  const active = groups.some((g) => g.id === selected) ? selected : 'all';
  const shown = all.filter(
    (e) => active === 'all' || groupFor(c.layout, e).id === active,
  );
  const item = all.find((e) => e.key === itemKey);
  const open = (key: string) => {
    const e = all.find((v) => v.key === key);
    if (e?.kind === 'route') onRoute(e.route);
    else if (e) onTrack(e.track.id);
  };
  const move = (key: string, group: string, before?: string) =>
    c.update(
      (l) => moveEntry(l, entries, key, group, before),
      `已移至${groups.find((g) => g.id === group)?.name ?? '分组'}`,
    );
  const stepItem = (key: string, delta: number) => {
    const entry = all.find((e) => e.key === key);
    if (!entry) return;
    const group = groupFor(c.layout, entry).id;
    const list = all.filter((e) => groupFor(c.layout, e).id === group),
      i = list.findIndex((e) => e.key === key),
      to = i + delta;
    if (to < 0 || to >= list.length) return;
    if (delta < 0) move(key, group, list[to].key);
    else move(list[to].key, group, key);
  };
  const stepGroup = (id: string, delta: number) => {
    const i = c.layout.groups.findIndex((g) => g.id === id),
      to = c.layout.groups[i + delta];
    if (to) c.update((l) => reorderGroup(l, id, to.id), '已调整分组顺序');
  };
  const drag = useCollectionDrag(root, (from, to) => {
    if (!c.ready) return;
    if (from.startsWith('group|') && to.startsWith('group|'))
      c.update(
        (l) => reorderGroup(l, from.slice(6), to.slice(6)),
        '已调整分组顺序',
      );
    if (from.startsWith('entry|')) {
      if (to.startsWith('group|')) move(from.slice(6), to.slice(6));
      else if (to.startsWith('entry|'))
        c.update(
          (l) => dropEntry(l, entries, from.slice(6), to.slice(6)),
          '已调整路线顺序与分组',
        );
    }
  });
  const rowClass = (id: string) =>
    `collection-row ${drag.dragging === id ? 'is-dragging' : ''} ${drag.target === id && drag.dragging !== id ? 'is-drop-target' : ''}`;
  return (
    <section
      ref={root}
      className="collections-panel"
      aria-label="收藏路线与轨迹"
    >
      {navigationError && (
        <p className="route-error" role="alert">
          {navigationError}
        </p>
      )}
      {editing ? (
        <GroupEditor
          key={editing.id}
          group={editing}
          disabled={!c.ready}
          onBack={() => {
            c.clearMessage();
            setEditing(null);
          }}
          onSave={(g) => {
            if (
              c.update((l) => {
                if (l.groups.some((v) => v.id !== g.id && v.name === g.name))
                  throw new Error('已有同名分组，请换个名称。');
                return {
                  ...l,
                  groups: l.groups.some((v) => v.id === g.id)
                    ? l.groups.map((v) => (v.id === g.id ? g : v))
                    : [...l.groups, g],
                };
              }, '分组已保存')
            )
              setEditing(null);
          }}
          onDelete={
            c.layout.groups.some((g) => g.id === editing.id)
              ? () => {
                  if (
                    c.update(
                      (l) => deleteGroup(l, editing.id),
                      '分组已删除，路线保留在未分组',
                    )
                  ) {
                    setEditing(null);
                    if (selected === editing.id) setSelected(UNFILED.id);
                  }
                }
              : undefined
          }
        />
      ) : item ? (
        <div
          className="collection-editor collection-scroll"
          data-collection-scroll="y"
        >
          <button
            className="collection-back"
            aria-label="返回收藏"
            onClick={() => setItemKey(null)}
          >
            ‹ 返回收藏
          </button>
          <strong>{item.name}</strong>
          <label>
            移动到分组
            <select
              aria-label="移动到分组"
              disabled={!c.ready}
              value={groupFor(c.layout, item).id}
              onChange={(e) => move(item.key, e.target.value)}
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <div className="collection-actions">
            <button disabled={!c.ready} onClick={() => stepItem(item.key, -1)}>
              <ArrowUp size={16} />
              上移
            </button>
            <button disabled={!c.ready} onClick={() => stepItem(item.key, 1)}>
              <ArrowDown size={16} />
              下移
            </button>
            <button onClick={() => open(item.key)}>打开路线</button>
          </div>
          {item.kind === 'route' && (
            <button
              className="collection-delete"
              onClick={() => favorites.remove(item.route.id)}
            >
              移除这条收藏
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="collection-actions">
            <button
              onClick={() => setView(view === 'list' ? 'groups' : 'list')}
            >
              <Settings2 size={16} />
              {view === 'list' ? '管理分组' : '返回收藏'}
            </button>
            <button
              disabled={!c.ready || c.layout.groups.length >= 64}
              onClick={() => {
                c.clearMessage();
                setView('groups');
                setEditing({
                  id: crypto.randomUUID(),
                  name: '',
                  color: COLORS[c.layout.groups.length % COLORS.length].value,
                });
              }}
            >
              <FolderPlus size={16} />
              新建分组
            </button>
          </div>
          {view === 'list' ? (
            <>
              <nav
                className="collection-tabs"
                data-collection-scroll="x"
                aria-label="收藏分类"
              >
                <button
                  aria-pressed={active === 'all'}
                  onClick={() => setSelected('all')}
                >
                  全部 <small>{all.length}</small>
                </button>
                {groups.map((g) => (
                  <button
                    key={g.id}
                    style={tint(g)}
                    data-collection-target={`group|${g.id}`}
                    className={
                      drag.target === `group|${g.id}` ? 'is-drop-target' : ''
                    }
                    aria-pressed={active === g.id}
                    onClick={() => setSelected(g.id)}
                  >
                    <i />
                    {g.name}
                    <small>
                      {
                        all.filter((e) => groupFor(c.layout, e).id === g.id)
                          .length
                      }
                    </small>
                  </button>
                ))}
              </nav>
              <p className="collection-hint">
                左右滑动选择分类；拖动手柄排序或换组
              </p>
              <div
                className="collection-scroll"
                data-collection-scroll="y"
                aria-label="收藏列表"
              >
                {!shown.length && (
                  <p className="collection-empty">
                    {all.length
                      ? '这个分组还没有路线，可从其他分组拖入。'
                      : '规划后收藏路线，或保存实走、导入、手绘轨迹，都会出现在这里。'}
                  </p>
                )}
                {shown.map((e) => {
                  const g = groupFor(c.layout, e),
                    id = `entry|${e.key}`;
                  return (
                    <div
                      key={e.key}
                      className={rowClass(id)}
                      style={tint(g)}
                      data-collection-target={id}
                      data-entry-key={e.key}
                    >
                      <button
                        className="collection-open"
                        onClick={() => open(e.key)}
                      >
                        <strong>{e.name}</strong>
                        <small>{e.detail}</small>
                        <span className="collection-badge">{g.name}</span>
                      </button>
                      <button
                        className="collection-navigate"
                        aria-label={`导航 ${e.name}`}
                        onClick={() =>
                          e.kind === 'route'
                            ? onNavigateRoute(e.route)
                            : onNavigateTrack(e.track.id)
                        }
                      >
                        导航
                      </button>
                      <button
                        className="collection-navigate"
                        aria-label={`分享 ${e.name}`}
                        onClick={() =>
                          e.kind === 'route'
                            ? onShareRoute(e.route)
                            : onShareTrack(e.track.id)
                        }
                      >
                        分享
                      </button>
                      <button
                        className="collection-icon"
                        aria-label={`整理 ${e.name}`}
                        onClick={() => setItemKey(e.key)}
                      >
                        <MoreHorizontal size={18} />
                      </button>
                      <button
                        className="collection-grip collection-icon"
                        aria-label={`拖动路线 ${e.name}`}
                        title="拖动换组；方向键上下排序"
                        disabled={!c.ready}
                        {...drag.handle(id)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
                            ev.preventDefault();
                            stepItem(e.key, ev.key === 'ArrowUp' ? -1 : 1);
                          }
                        }}
                      >
                        <GripVertical size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div
              className="collection-scroll"
              data-collection-scroll="y"
              aria-label="分组列表"
            >
              <p className="collection-hint">
                点名称修改颜色与名称，拖动手柄调整分组顺序
              </p>
              {c.layout.groups.map((g) => {
                const id = `group|${g.id}`;
                return (
                  <div
                    key={g.id}
                    className={rowClass(id)}
                    data-collection-target={id}
                    style={tint(g)}
                  >
                    <button
                      className="collection-open"
                      onClick={() => {
                        c.clearMessage();
                        setEditing(g);
                      }}
                    >
                      <strong>{g.name}</strong>
                      <small>
                        {
                          all.filter((e) => groupFor(c.layout, e).id === g.id)
                            .length
                        }{' '}
                        条路线
                      </small>
                    </button>
                    <button
                      className="collection-grip collection-icon"
                      disabled={!c.ready}
                      aria-label={`拖动分组 ${g.name}`}
                      title="拖动或方向键上下排序"
                      {...drag.handle(id)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
                          ev.preventDefault();
                          stepGroup(g.id, ev.key === 'ArrowUp' ? -1 : 1);
                        }
                      }}
                    >
                      <GripVertical size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
      <p className="collection-status" role="status">
        {c.message ||
          favorites.message ||
          (drag.dragging ? '松手保存，移出窗口取消' : '')}
      </p>
    </section>
  );
}
