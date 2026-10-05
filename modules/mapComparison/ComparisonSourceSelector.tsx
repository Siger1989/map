import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Star } from 'lucide-react';
import type { ComparisonChoice } from './choices';
import {
  COMPARISON_SOURCE_GROUP_ORDER,
  comparisonSourceGroups,
  readComparisonSourceOpenGroups,
  subscribeComparisonSourceOpenGroups,
  visibleComparisonSourceChoices,
  writeComparisonSourceOpenGroups,
  type ComparisonSourceGroupName,
} from './comparisonSourceGroups';
import { readFavoriteSourceKeys, subscribeFavoriteSourceKeys, writeFavoriteSourceKeys } from '../mapSources/favorites';

type Props = {
  side: string;
  pane: 0 | 1;
  onTriggerRef?: (element: HTMLButtonElement | null) => void;
  choices: ComparisonChoice[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function ComparisonSourceSelector({ side, pane, choices, selectedId, onSelect, onTriggerRef }: Props) {
  const [open, setOpen] = useState(false);
  const [favoriteKeys, setFavoriteKeys] = useState(readFavoriteSourceKeys);
  const [openGroups, setOpenGroups] = useState(readComparisonSourceOpenGroups);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const groups = useMemo(() => comparisonSourceGroups(choices, favoriteKeys), [choices, favoriteKeys]);
  const selected = choices.find(item => item.id === selectedId) ?? choices[0];
  const stepChoices = useMemo(() => visibleComparisonSourceChoices(groups, openGroups), [groups, openGroups]);

  useEffect(() => subscribeFavoriteSourceKeys(setFavoriteKeys), []);
  useEffect(() => subscribeComparisonSourceOpenGroups(setOpenGroups), []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (root.current?.contains(event.target as Node)) return;
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('mousedown', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('mousedown', outside, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, [open]);

  const closeAndRestore = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  const toggleGroup = (name: ComparisonSourceGroupName) => {
    const next = openGroups.includes(name) ? openGroups.filter(item => item !== name) : [...openGroups, name];
    if (writeComparisonSourceOpenGroups(next)) setOpenGroups(next);
  };
  const toggleFavorite = (id: string) => {
    const next = favoriteKeys.includes(id) ? favoriteKeys.filter(item => item !== id) : [...favoriteKeys, id];
    if (writeFavoriteSourceKeys(next)) setFavoriteKeys(next);
  };
  const moveFocus = (id: string, direction: -1 | 1) => {
    const ids = stepChoices.map(item => item.id);
    if (!ids.length) return;
    const current = ids.indexOf(id);
    const nextId = ids[(Math.max(0, current) + direction + ids.length) % ids.length];
    optionRefs.current.get(nextId)?.focus({ preventScroll: true });
  };
  const onPopupKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); closeAndRestore();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const id = (event.target as HTMLElement).closest<HTMLElement>('[data-choice-id]')?.dataset.choiceId;
      if (id) { event.preventDefault(); moveFocus(id, event.key === 'ArrowDown' ? 1 : -1); }
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const id = event.key === 'Home' ? stepChoices[0]?.id : stepChoices.at(-1)?.id;
      if (id) optionRefs.current.get(id)?.focus({ preventScroll: true });
    }
  };
  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setOpen(true);
    }
  };

  return <div className="comparison-source-picker" data-pane={pane} ref={root}>
    <button ref={element => { trigger.current = element; onTriggerRef?.(element); }} type="button" className="comparison-source-trigger" aria-label={`${side}方图源`} aria-haspopup="dialog" aria-expanded={open}
      onKeyDown={onTriggerKeyDown} onClick={() => setOpen(value => !value)}>
      <span>{selected?.name ?? '选择图源'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="comparison-source-popup" role="dialog" aria-label={`${side}方图源选择`} onKeyDown={onPopupKeyDown}>
      {COMPARISON_SOURCE_GROUP_ORDER.map(name => {
        const group = groups.find(item => item.name === name);
        if (!group) return null;
        const expanded = openGroups.includes(name);
        return <section className={`comparison-source-group comparison-source-group-${COMPARISON_SOURCE_GROUP_ORDER.indexOf(name)}`} key={name}>
          <button type="button" className="comparison-source-group-heading" aria-expanded={expanded}
            onClick={() => toggleGroup(name)}><span>{name}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span></button>
          {expanded && group.choices.map(item => {
            const favorite = favoriteKeys.includes(item.id);
            return <div className="comparison-source-row" key={item.id}>
              <button type="button" role="option" aria-selected={item.id === selectedId} data-choice-id={item.id}
                ref={element => { if (element) optionRefs.current.set(item.id, element); else optionRefs.current.delete(item.id); }}
                onClick={() => { onSelect(item.id); closeAndRestore(); }}><span>{item.name}</span>{item.id === selectedId && <span aria-hidden="true">✓</span>}</button>
              <button type="button" className="comparison-source-favorite" aria-label={`${favorite ? '移出' : '加入'}常用：${item.name}`} aria-pressed={favorite}
                onClick={() => toggleFavorite(item.id)}><Star size={15} fill={favorite ? 'currentColor' : 'none'}/></button>
            </div>;
          })}
        </section>;
      })}
    </div>}
  </div>;
}
