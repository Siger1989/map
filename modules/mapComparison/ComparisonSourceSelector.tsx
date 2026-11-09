import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Star } from 'lucide-react';
import type { ComparisonChoice } from './choices';
import type { MapSourceHealthResult } from '../mapSources/health';
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
import { sourcePopupPlacement } from './sourcePopupPlacement';

type Props = {
  side: string;
  pane: 0 | 1;
  onTriggerRef?: (element: HTMLButtonElement | null) => void;
  choices: ComparisonChoice[];
  selectedId: string;
  onSelect: (id: string) => void;
  onProbe?: (choice: ComparisonChoice, signal?: AbortSignal) => Promise<MapSourceHealthResult>;
};

export function ComparisonSourceSelector({ side, pane, choices, selectedId, onSelect, onTriggerRef, onProbe }: Props) {
  const [open, setOpen] = useState(false);
  const [favoriteKeys, setFavoriteKeys] = useState(readFavoriteSourceKeys);
  const [openGroups, setOpenGroups] = useState(readComparisonSourceOpenGroups);
  const [popupLayout, setPopupLayout] = useState<{ side: 'above' | 'below'; maxHeight: number } | null>(null);
  const [results, setResults] = useState<Record<string, MapSourceHealthResult>>({});
  const [lastTested, setLastTested] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const activeRequest = useRef(0);
  const activeProbe = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; activeRequest.current++; activeProbe.current?.abort(); activeProbe.current = null; }; }, []);
  const cancelProbe = () => {
    if (!activeProbe.current) return;
    activeRequest.current++;
    activeProbe.current?.abort();
    activeProbe.current = null;
    setTesting(null);
    setLastTested('');
  };
  const probe = async (item: ComparisonChoice) => {
    if (!onProbe || testing || activeProbe.current) return;
    const serial = ++activeRequest.current;
    const controller = new AbortController();
    activeProbe.current = controller;
    setTesting(item.id); setLastTested(item.id);
    setResults(old => { const next = { ...old }; delete next[item.id]; return next; });
    try {
      const result = await onProbe(item, controller.signal);
      if (mounted.current && activeRequest.current === serial) setResults(old => ({ ...old, [item.id]: result }));
    } catch {
      if (mounted.current && activeRequest.current === serial) setResults(old => ({ ...old, [item.id]: {
        status: 'unknown', message: '图源测试未完成，请稍后重试', successes: 0, missing: 0, failures: 0, sampled: 0,
      } }));
    } finally { if (mounted.current && activeRequest.current === serial) { setTesting(null); activeProbe.current = null; } }
  };
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const groups = useMemo(() => comparisonSourceGroups(choices, favoriteKeys), [choices, favoriteKeys]);
  const selected = choices.find(item => item.id === selectedId) ?? choices[0];
  const stepChoices = useMemo(() => visibleComparisonSourceChoices(groups, openGroups), [groups, openGroups]);

  useEffect(() => subscribeFavoriteSourceKeys(setFavoriteKeys), []);
  useEffect(() => subscribeComparisonSourceOpenGroups(setOpenGroups), []);
  useLayoutEffect(() => {
    if (!open) { setPopupLayout(null); return; }
    const measure = () => {
      const popupNode = popup.current;
      const triggerNode = trigger.current;
      const ui = root.current?.closest<HTMLElement>('.map-comparison-ui');
      if (!popupNode || !triggerNode || !ui) return;
      const uiRect = ui.getBoundingClientRect();
      const triggerRect = triggerNode.getBoundingClientRect();
      const style = getComputedStyle(ui);
      const visual = window.visualViewport;
      const safeTop = Math.max(uiRect.top + (Number.parseFloat(style.paddingTop) || 0) + 8, visual?.offsetTop ?? 0);
      const safeBottom = Math.min(
        uiRect.bottom - (Number.parseFloat(style.paddingBottom) || 0) - 8,
        visual ? visual.offsetTop + visual.height : window.innerHeight,
      );
      const placement = sourcePopupPlacement({
        triggerTop: triggerRect.top,
        triggerBottom: triggerRect.bottom,
        safeTop,
        safeBottom,
        contentHeight: popupNode.scrollHeight,
        preferredMaxHeight: Math.min(window.innerHeight * 0.48, 480),
      });
      setPopupLayout(current => current?.side === placement.side && current.maxHeight === placement.maxHeight ? current : placement);
    };
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [open, openGroups, choices.length, favoriteKeys.length, results, lastTested, testing]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (root.current?.contains(event.target as Node)) return;
      cancelProbe(); setOpen(false);
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
    cancelProbe();
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
      onKeyDown={onTriggerKeyDown} onClick={() => { if (open) cancelProbe(); setOpen(!open); }}>
      <span>{selected?.name ?? '选择图源'}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div
      ref={popup}
      className="comparison-source-popup"
      data-placement={popupLayout?.side ?? (pane === 1 ? 'above' : 'below')}
      style={popupLayout ? { maxHeight: `${popupLayout.maxHeight}px` } : undefined}
      role="dialog"
      aria-label={`${side}方图源选择`}
      onKeyDown={onPopupKeyDown}
    >
      {onProbe && <div className="comparison-source-health">
        <button type="button" disabled={!!testing || !selected} onClick={() => selected && void probe(selected)}>
          {testing ? '正在测试…' : '测试当前图源当前位置'}
        </button>
        {results[lastTested] && <p role="status" data-health={results[lastTested]!.status}>
          上次测试：{results[lastTested]!.sourceName ? `${results[lastTested]!.sourceName} · ` : ''}{results[lastTested]!.message}
          {results[lastTested]!.sampled > 0 && `（${results[lastTested]!.successes}可读 / ${results[lastTested]!.sampled}）`}
          {results[lastTested]!.testedZoom !== undefined && ` · z${results[lastTested]!.testedZoom}`}
          {results[lastTested]!.elapsedMs !== undefined && ` · ${(results[lastTested]!.elapsedMs! / 1000).toFixed(1)}秒`}
          {results[lastTested]!.testedAt && ` · ${new Date(results[lastTested]!.testedAt!).toLocaleTimeString()}`}
          {results[lastTested]!.scope === 'base-layer-only' && ' · 仅测OVMAP底层'}
        </p>}
        {!testing && lastTested && lastTested !== selectedId && results[lastTested] && <button type="button"
          onClick={() => { onSelect(lastTested); closeAndRestore(); }}>使用此备用图源，保留视角</button>}
      </div>}
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
                onClick={() => { cancelProbe(); onSelect(item.id); closeAndRestore(); }}><span>{item.name}</span>{item.id === selectedId && <span aria-hidden="true">✓</span>}</button>
              <button type="button" className="comparison-source-favorite" aria-label={`${favorite ? '移出' : '加入'}常用：${item.name}`} aria-pressed={favorite}
                onClick={() => toggleFavorite(item.id)}><Star size={15} fill={favorite ? 'currentColor' : 'none'}/></button>
              {onProbe && <button type="button" className="comparison-source-probe" disabled={!!testing}
                aria-label={`测试${side}方图源：${item.name}`} onClick={() => void probe(item)}>体检</button>}
            </div>;
          })}
        </section>;
      })}
    </div>}
  </div>;
}
