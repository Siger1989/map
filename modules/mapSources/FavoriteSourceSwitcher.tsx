import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Star } from 'lucide-react';
import { readFavoriteSourceKeys, subscribeFavoriteSourceKeys } from './favorites';
import './favoriteSourceSwitcher.css';

export type FavoriteSourceOption = {
  id: string;
  name: string;
  group?: '当前' | '内置' | '我的图源' | '公共库';
};

export type FavoriteSourceSwitcherProps = {
  choices: readonly FavoriteSourceOption[];
  currentId: string;
  onSelect: (id: string) => void;
  onManage: () => void;
  onOpenChange?: (open: boolean) => void;
};

const sourceGroup = (group?: FavoriteSourceOption['group']) =>
  group === '内置' ? 'builtin' : group === '我的图源' ? 'saved' : group === '公共库' ? 'public' : 'current';

/** Compact map-side picker. Selection is transient and deliberately does not touch camera state. */
export function FavoriteSourceSwitcher({ choices, currentId, onSelect, onManage, onOpenChange }: FavoriteSourceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [favoriteKeys, setFavoriteKeys] = useState(readFavoriteSourceKeys);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const favorites = useMemo(() => {
    const keys = new Set(favoriteKeys);
    return choices.filter(choice => keys.has(choice.id));
  }, [choices, favoriteKeys]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    onOpenChangeRef.current?.(next);
  };

  useEffect(() => subscribeFavoriteSourceKeys(setFavoriteKeys), []);
  useEffect(() => () => { onOpenChangeRef.current?.(false); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (root.current?.contains(event.target as Node)) return;
      changeOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      changeOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  const choose = (id: string) => {
    onSelect(id);
    changeOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-favorite-source]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (!buttons.length) return;
    event.preventDefault();
    buttons[(Math.max(index, 0) + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus({ preventScroll: true });
  };

  return <div className="favorite-source-switcher" ref={root}>
    <button ref={trigger} type="button" className="favorite-source-trigger position-dock-button glass" title="收藏图源"
      aria-label="收藏图源快捷切换" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => changeOpen(!open)}>
      <Star size={20} aria-hidden="true" />
      <small>图源</small>
    </button>
    {open && <div className="favorite-source-popup glass" role="dialog" aria-label="收藏图源快捷切换" onKeyDown={onPopupKeyDown}>
      {favorites.length ? <div className="favorite-source-list">
        {favorites.map(choice => <button key={choice.id} type="button" data-favorite-source={choice.id}
          data-group={sourceGroup(choice.group)} aria-current={choice.id === currentId ? 'true' : undefined}
          onClick={() => choose(choice.id)}>
          <Star size={14} fill="currentColor" aria-hidden="true" />
          <span>{choice.name}</span>
          {choice.id === currentId && <span className="favorite-source-current" aria-label="当前图源">✓</span>}
        </button>)}
      </div> : <p className="favorite-source-empty">还没有收藏图源</p>}
      <button type="button" className="favorite-source-manage" onClick={() => { changeOpen(false); onManage(); }}>
        {favorites.length ? '管理收藏图源' : '打开图源列表'}
      </button>
    </div>}
  </div>;
}
