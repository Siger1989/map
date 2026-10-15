import { RouteProviderNote } from './RouteProviderNote';
import { RouteResultSummary } from './RouteResultSummary';
import type { ReactNode } from 'react';
import './routeCompact.css';
import { FloatingSearch } from '../input/FloatingSearch';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  ArrowDownUp,
  MapPin,
  LocateFixed,
  ChevronDown,
  ChevronUp,
  Search,
  SlidersHorizontal,
  GripVertical,
  Plus,
  X,
} from 'lucide-react';
import { usePlaceSearch } from './usePlaceSearch';
import { useRouteKeyboardFocus } from './useRouteKeyboardFocus';
import { SearchOptions } from './SearchOptions';
import { PlaceResultList, SearchFeedback, SearchFooter } from './SearchFeedback';
import { MAX_ROUTE_STOPS, stopLabel } from './stops';
import {
  TRAVEL_MODES,
  type Coordinate,
  type Endpoint,
  type PlannedRoute,
  type RoutePlace,
} from './types';
import type { NavigationState } from './useNavigation';
export function RoutePanel({
  navigation: n,
  near,
  onPick,
  onPlace,
  onShow,
  onSave,
  saveMessage,
  onCurrentPosition,
  locating,
  onStartNavigation,
  navigating,
  guidanceError,
  onShare,
  onEditPoints,
  onCancel,
  onImport,
  importInHeader = false,
  onRouteApplied,
  previewMode,
  onPreview,
  onPreviewTopDown,
  onExitPreview,
  waitingForPosition = false,
  quickRouteControls,
}: {
  navigation: NavigationState;
  near: Coordinate;
  onPick: (slot: Endpoint) => void;
  onPlace: (place: RoutePlace) => void;
  onShow: (route: PlannedRoute) => void;
  onSave: () => void;
  saveMessage: string;
  onCurrentPosition: () => void;
  locating: boolean;
  onStartNavigation: () => void;
  navigating: boolean;
  guidanceError: string;
  onShare: () => void;
  onEditPoints?: () => void; onCancel?: () => void;
  onImport?: () => void;
  importInHeader?: boolean;
  onRouteApplied?: (route: PlannedRoute) => void;
  previewMode?: 'forward' | 'top' | null;
  onPreview?: () => void;
  onPreviewTopDown?: () => void;
  onExitPreview?: () => void;
  waitingForPosition?: boolean;
  quickRouteControls?: ReactNode;
}) {
  const [editing, setEditing] = useState(() => !n.route);
  const previousRoute = useRef(n.route?.createdAt);
  useEffect(() => {
    if (n.route && previousRoute.current !== n.route.createdAt) setEditing(false);
    previousRoute.current = n.route?.createdAt;
  }, [n.route?.createdAt]);
  const [active, setActive] = useState<string | null>(null),
    [composing, setComposing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [target, setTarget] = useState<number | null>(null),
    [dragging, setDragging] = useState<string | null>(null),
    [announcement, setAnnouncement] = useState('');
  const rows = useRef<HTMLDivElement>(null),
    drag = useRef<{
      id: string;
      pointer: number;
      to: number;
      y: number;
      frame: number;
    } | null>(null);
  const previousCount = useRef(n.stops.length);
  useRouteKeyboardFocus(rows);
  const destination = n.stops.at(-1)?.place;
  useEffect(() => {
    const origin = n.stops[0];
    if (waitingForPosition || !destination || !origin || origin.place || origin.query.trim() || n.picking !== null) return;
    setEditing(true);
    setActive(origin.id);
    const frame = requestAnimationFrame(() => {
      rows.current?.querySelector<HTMLInputElement>(`[data-stop-id="${origin.id}"] input`)
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [destination, n.stops[0]?.place, n.stops[0]?.query, n.picking, waitingForPosition]);
  useEffect(() => {
    if (n.stops.length > previousCount.current) {
      const added = n.stops.at(-2)!;
      setActive(added.id);
      const input = rows.current?.querySelector<HTMLInputElement>(
        `[data-stop-id="${added.id}"] input`,
      );
      input?.focus({ preventScroll: true });
      input?.scrollIntoView({ block: 'nearest' });
    }
    previousCount.current = n.stops.length;
  }, [n.stops]);
  const selected = n.stops.find((s) => s.id === active);
  const searchActive = !!selected && !selected.place && selected.query.trim().length >= 2;
  const placeSearch = usePlaceSearch({
    query: selected?.query ?? '',
    enabled: !!selected && !selected.place && active !== null,
    composing,
    near,
  });
  const pickingIndex =
    n.picking === 'start'
      ? 0
      : n.picking === 'end'
        ? n.stops.length - 1
        : n.picking;
  const missingIndex = n.stops.findIndex((stop) => !stop.place);
  const activeIndex = n.stops.findIndex((stop) => stop.id === active);
  const nextIndex = pickingIndex ?? (activeIndex >= 0 ? activeIndex : missingIndex);
  const nextLabel = nextIndex >= 0 ? stopLabel(nextIndex, n.stops.length) : '';
  useEffect(() => {
    if (pickingIndex === null) return;
    rows.current
      ?.querySelector<HTMLElement>(
        `[data-stop-id="${n.stops[pickingIndex]?.id}"]`,
      )
      ?.scrollIntoView({ block: 'nearest' });
  }, [pickingIndex]);
  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
    },
    [],
  );
  const searchStop = (id: string) => {
    setListExpanded(false);
    setFiltersOpen(false);
    setActive(id);
    placeSearch.searchNow();
  };
  const targetAt = (y: number) => {
    const list = Array.from(
      rows.current?.querySelectorAll<HTMLElement>('[data-stop-id]') ?? [],
    );
    let nearest = 0,
      distance = Infinity;
    list.forEach((el, i) => {
      const b = el.getBoundingClientRect(),
        d = Math.abs(y - (b.top + b.height / 2));
      if (d < distance) {
        nearest = i;
        distance = d;
      }
    });
    if (drag.current) {
      drag.current.to = nearest;
      setTarget(nearest);
    }
  };
  const begin = (
    id: string,
    index: number,
    e: PointerEvent<HTMLButtonElement>,
  ) => {
    if (!e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActive(null); setListExpanded(false); setFiltersOpen(false);
    setDragging(id);
    setTarget(index);
    drag.current = {
      id,
      pointer: e.pointerId,
      to: index,
      y: e.clientY,
      frame: 0,
    };
    const scroll = () => {
      const d = drag.current;
      if (!d) return;
      const panel = rows.current?.closest<HTMLElement>('.dock-content');
      if (panel) {
        const r = panel.getBoundingClientRect();
        const delta = d.y < r.top + 32 ? -6 : d.y > r.bottom - 32 ? 6 : 0;
        if (delta) {
          panel.scrollTop += delta;
          targetAt(d.y);
        }
      }
      d.frame = requestAnimationFrame(scroll);
    };
    drag.current.frame = requestAnimationFrame(scroll);
  };
  const finish = (e: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    cancelAnimationFrame(d.frame);
    drag.current = null;
    setDragging(null);
    setTarget(null);
    if (!cancel) {
      const from = n.stops.findIndex((s) => s.id === d.id);
      n.reorder(from, d.to);
      setAnnouncement(`已移到${stopLabel(d.to, n.stops.length)}`);
    }
  };
  if (n.route && !editing && n.picking === null) return <RouteResultSummary
    start={n.start} end={n.end} mode={n.mode} loading={n.loading}
    planningError={n.error}
    onModeChange={(mode) => { onExitPreview?.(); n.setMode(mode, onRouteApplied); }} onSwap={() => { onExitPreview?.(); n.swap(onRouteApplied); }}
    route={n.route} onShow={() => onShow(n.route!)} onEdit={() => { onExitPreview?.(); setEditing(true); }}
    onSave={onSave} onShare={onShare} onStartNavigation={onStartNavigation}
    previewMode={previewMode} onPreview={onPreview} onPreviewTopDown={onPreviewTopDown} onExitPreview={onExitPreview}
    navigating={navigating} guidanceError={guidanceError} saveMessage={saveMessage} onEditPoints={onEditPoints} onCancel={onCancel}
    quickRouteControls={quickRouteControls}
  />;
  return (
    <div className="route-panel" data-picking={n.picking !== null} data-search-active={searchActive} data-search-expanded={searchActive && listExpanded}>
      {onImport && !importInHeader && <button className="route-load" onClick={onImport}>加载路线文件</button>}
      {n.picking !== null && (
        <div className="route-picking-help" role="status">
          <span>
            <strong>选择{n.pickingLabel}</strong>
            <small>点已有标记，或在地图空白处选点</small>
          </span>
          <button onClick={() => n.setPicking(null)}>取消选点</button>
        </div>
      )}
      {n.error && (
        <p role="alert" className="route-error">
          {n.error}
        </p>
      )}
      {waitingForPosition && <p className="route-next-step" role="status">正在获取当前位置，定位后自动规划；也可手动选择起点。</p>}
      <div className="route-modes" aria-label="出行方式">
        {TRAVEL_MODES.map((m) => (
          <button
            key={m.id}
            aria-pressed={n.mode === m.id}
            onClick={() => n.setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <button
        className="route-primary"
        disabled={n.loading}
        onClick={async () => {
          const missing = n.stops.find((s) => !s.place);
          setActive(missing?.id ?? null);
          const route = await n.calculate(onRouteApplied);
          if (missing) {
            rows.current
              ?.querySelector<HTMLInputElement>(
                `[data-stop-id="${missing.id}"] input`,
              )
              ?.focus({ preventScroll: true });
          }
          if (route) onShow(route);
        }}
      >
        {n.loading
          ? '规划中…'
          : `规划路线${n.stops.length > 2 ? ` · ${n.stops.length - 2} 个途经点` : ''}`}
      </button>
      {n.route && <div className="route-edit-actions"><button onClick={() => { setEditing(false); onShow(n.route!); }}>返回路线概览</button></div>}
      <RouteProviderNote />
      <span className="route-sort-status" role="status">
        {announcement}
      </span>
      {n.picking === null && (
        <div className="route-next-step" role="status">
          {nextIndex >= 0
            ? `${activeIndex >= 0 ? '正在输入' : '下一步选'}${nextLabel} · 可输入地点或点“选点”`
            : '起点和终点已设置 · 可以规划路线'}
        </div>
      )}
      <div ref={rows} className="route-stop-list">
        {n.stops.map((s, index) => {
          const label = stopLabel(index, n.stops.length),
            focused = active === s.id;
          return (
            <div
              key={s.id}
              data-stop-id={s.id}
              className={`route-stop-block ${pickingIndex === index ? 'is-picking' : ''} ${focused ? 'is-active' : ''} ${nextIndex === index ? 'is-next' : ''} ${dragging === s.id ? 'is-dragging' : ''} ${dragging && target === index ? 'is-drop-target' : ''}`}
            >
              <form
                className="route-stop-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  searchStop(s.id);
                }}
              >
                <span
                  className={`route-dot ${index === 0 ? 'start' : index === n.stops.length - 1 ? 'end' : 'via'}`}
                >
                  {index === 0
                    ? '起'
                    : index === n.stops.length - 1
                      ? '终'
                      : index}
                </span>
                <strong className="route-stop-label">{label}</strong>
                <input
                  aria-label={label}
                  autoComplete="off"
                  enterKeyHint="search"
                  placeholder={`输入${label}`}
                  value={s.query}
                  maxLength={120}
                  onFocus={() => {
                    n.setPicking(null);
                    if (active !== s.id) { setListExpanded(false); setFiltersOpen(false); }
                    setActive(s.id);
                  }}
                  onCompositionStart={() => setComposing(true)}
                  onCompositionEnd={() => setComposing(false)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      const first = document.querySelector<HTMLButtonElement>(
                        '[data-search-owner="route"] [data-place-result]',
                      );
                      if (first) { event.preventDefault(); first.focus(); }
                    } else if (event.key === 'Escape' && active === s.id) {
                      event.preventDefault();
                      setActive(null); setListExpanded(false); setFiltersOpen(false);
                      (event.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  onChange={(e) => {
                    setActive(s.id);
                    n.edit(index, e.target.value);
                  }}
                />
                <button
                  type="button"
                  className="stop-icon stop-pick"
                  aria-label={`在地图选择${label}`}
                  aria-pressed={pickingIndex === index}
                  title="点击地图上的已有标记或空白位置"
                  onClick={() => {
                    setActive(null); setListExpanded(false); setFiltersOpen(false);
                    (document.activeElement as HTMLElement)?.blur();
                    if (pickingIndex === index) n.setPicking(null);
                    else onPick(index);
                  }}
                >
                  <MapPin size={15} />
                  <span>选点</span>
                </button>
                <button
                  type="button"
                  className="stop-drag"
                  aria-label={`拖动排序${label}`}
                  title="拖动排序，方向键上下移动"
                  onPointerDown={(e) => begin(s.id, index, e)}
                  onPointerMove={(e) => {
                    if (drag.current?.pointer === e.pointerId) {
                      drag.current.y = e.clientY;
                      targetAt(e.clientY);
                    }
                  }}
                  onPointerUp={(e) => finish(e)}
                  onPointerCancel={(e) => finish(e, true)}
                  onLostPointerCapture={(e) => finish(e, true)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActive(null); setListExpanded(false); setFiltersOpen(false);
                      n.reorder(index, index + (e.key === 'ArrowUp' ? -1 : 1));
                    }
                  }}
                >
                  <GripVertical size={18} />
                </button>
                {index > 0 && index < n.stops.length - 1 && (
                  <button
                    type="button"
                    className="stop-icon stop-remove"
                    aria-label={`删除${label}`}
                    title={`删除${label}`}
                    disabled={dragging !== null}
                    onClick={() => {
                      setActive(null); setListExpanded(false); setFiltersOpen(false);
                      n.remove(index);
                      setAnnouncement(`已删除${label}`);
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </form>
              {focused && !s.place && s.query.trim().length > 0 && (
                <div className="stop-edit-options">
                  <button
                    disabled={
                      placeSearch.busy || s.query.trim().length < 2 || !!s.place
                    }
                    onClick={() => searchStop(s.id)}
                  >
                    <Search size={13} />
                    {placeSearch.busy ? '搜索中…' : '搜索'}
                  </button>
                  {s.query && (
                    <button onClick={() => { n.edit(index, ''); setListExpanded(false); setFiltersOpen(false); }}>清空</button>
                  )}
                  <button
                    aria-label={`收起${label}搜索`}
                    onClick={() => {
                      setActive(null); setListExpanded(false); setFiltersOpen(false);
                      (document.activeElement as HTMLElement)?.blur();
                    }}
                  >
                    <X size={13} />
                    收起搜索
                  </button>
                </div>
              )}
              {focused && !s.place && s.query.trim().length === 1 && (
                <p className="route-search-inline-hint" role="status">
                  再输入一个字搜索地点。
                </p>
              )}
              {focused && !s.place && s.query.trim().length >= 2 && (
                <FloatingSearch
                  owner="route"
                  scrollable
                  maxHeight={listExpanded ? 340 : 205}
                  expandToViewport={listExpanded}
                  anchor={
                    rows.current?.querySelector<HTMLElement>(
                      `[data-stop-id="${s.id}"] input`,
                    ) ?? null
                  }
                >
                  <dialog open className="place-search-results glass route-place-results" aria-modal={false} aria-label={`${label}搜索结果`}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setActive(null); setListExpanded(false); setFiltersOpen(false); }
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        if (!(event.target instanceof Element) || !event.target.matches('[data-place-result]')) return;
                        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-place-result]'));
                        if (!buttons.length) return;
                        event.preventDefault();
                        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
                        const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : current <= 0 ? buttons.length - 1 : current - 1;
                        buttons[next]?.focus();
                      }
                    }}>
                    <div className="place-search-heading">
                      <span className="place-search-heading-title">{label} · {'\u5df2\u8f7d'} {placeSearch.places.length} {'\u6761'}</span>
                      <div className="place-search-heading-actions">
                        <button type="button" className="place-search-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
                          <SlidersHorizontal size={14} /><span>{'\u7b5b\u9009'}</span>
                        </button>
                        <button type="button" className="place-search-expand-toggle" aria-label={listExpanded ? '\u6536\u8d77\u5217\u8868' : '\u5c55\u5f00\u5217\u8868'} aria-expanded={listExpanded} onClick={() => setListExpanded((value) => !value)}>
                          {listExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span>{listExpanded ? '\u6536\u8d77' : '\u5c55\u5f00'}</span>
                        </button>
                        <button type="button" aria-label={'\u5173\u95ed\u641c\u7d22'} onClick={() => { setActive(null); setListExpanded(false); setFiltersOpen(false); }}><X size={14} /></button>
                      </div>
                    </div>
                    {filtersOpen && <SearchOptions
                      source={placeSearch.source} onSourceChange={placeSearch.setSource}
                      city={placeSearch.city} onCityChange={placeSearch.setCity}
                      nationwide={placeSearch.nationwide} onNationwideChange={placeSearch.setNationwide}
                    />}
                    <div className="place-search-options">
                      <PlaceResultList places={placeSearch.places} query={s.query} near={near} route onSelect={(place) => {
                        const nextStop = index === 0 ? n.stops.at(-1) : undefined;
                        const focusDestination = !!nextStop && nextStop.id !== s.id && !nextStop.place;
                        n.place(index, place);
                        onPlace(place);
                        setActive(focusDestination ? nextStop?.id ?? null : null);
                        setListExpanded(false);
                        setFiltersOpen(false);
                        if (focusDestination && nextStop) {
                          requestAnimationFrame(() => {
                            const input = rows.current?.querySelector<HTMLInputElement>(`[data-stop-id="${nextStop.id}"] input`);
                            input?.focus({ preventScroll: true });
                            input?.scrollIntoView({ block: 'nearest' });
                          });
                        }
                      }} />
                      <SearchFeedback
                        error={placeSearch.error} busy={placeSearch.busy} warnings={placeSearch.warnings}
                        suggestions={placeSearch.suggestions}
                        onSuggestion={(suggestion) => {
                          n.edit(index, suggestion.query);
                          placeSearch.setCity(suggestion.city ?? '');
                          placeSearch.searchNow();
                        }}
                        hasResults={placeSearch.places.length > 0}
                      />
                    </div>
                    <SearchFooter loadedCount={placeSearch.places.length} hasMore={!!placeSearch.next} busy={placeSearch.busy} onLoadMore={placeSearch.loadMore} source={placeSearch.source} />
                  </dialog>
                </FloatingSearch>
              )}
            </div>
          );
        })}
      </div>
      <div className="route-edit-actions">
        <button
          disabled={n.stops.length >= MAX_ROUTE_STOPS}
          onClick={() => {
            setActive(null); setListExpanded(false); setFiltersOpen(false);
            n.add();
          }}
        >
          <Plus size={14} />
          途经点
        </button>
        <button className="route-current-position" disabled={locating} onClick={onCurrentPosition}>
          <LocateFixed size={16} aria-hidden="true" />
          {locating ? '定位中…' : '我的位置'}
        </button>
        <button
          onClick={() => {
            setActive(null); setListExpanded(false); setFiltersOpen(false);
            n.swap(onRouteApplied);
          }}
        >
          <ArrowDownUp size={13} />
          反向
        </button>
        <button
          onClick={() => {
            setActive(null); setListExpanded(false); setFiltersOpen(false);
            n.clear();
          }}
        >
          清除
        </button>
      </div>

    </div>
  );
}
