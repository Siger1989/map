import { isLayoutInteraction } from '../uiLayout/events';
import { FloatingSearch } from '../input/FloatingSearch';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Coordinate, RoutePlace } from '../navigation/types';
import { isDesktopShell } from '../platform/desktop';
import { useMapPlaceLabel } from './PlaceName';
import { usePlaceSearch } from '../navigation/usePlaceSearch';
import { SearchOptions } from '../navigation/SearchOptions';
import { PlaceResultList, SearchFeedback, SearchFooter, SearchHistoryList, SelectedPlaceCard } from '../navigation/SearchFeedback';
import { useSearchHistory } from '../navigation/useSearchHistory';

export function PlaceSearch({
  center,
  zoom,
  onOpen,
  onSelect,
  onNavigate,
  onShare,
}: {
  center: Coordinate | null;
  zoom: number;
  onOpen: () => void;
  onSelect: (place: RoutePlace) => void;
  onNavigate?: (place: RoutePlace) => void;
  onShare: (place: RoutePlace) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<RoutePlace | null>(null);
  const [composing, setComposing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const desktopShell = isDesktopShell();
  const search = usePlaceSearch({ query, enabled: open && !selectedPlace, composing, near: center });
  const history = useSearchHistory();
  const { title } = useMapPlaceLabel(center, zoom);
  const historyView = !selectedPlace && !query.trim();
  const historyHeight = Math.min(320, Math.max(76, 68 + Math.min(history.entries.length, 6) * 40));
  const recordSearch = (value: string) => { const normalized = value.trim(); if (normalized.length > 1) history.record(normalized); };
  const closeSearch = () => { setOpen(false); setListExpanded(false); setFiltersOpen(false); setSelectedPlace(null); };

  const navigateResults = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); input?.focus(); closeSearch();
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const target = event.target;
    if (!(target === input || (target instanceof Element && target.matches('[data-place-result]')))) return;
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-search-owner="place"] [data-place-result]'));
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (current + 1) % buttons.length : current <= 0 ? buttons.length - 1 : current - 1;
    buttons[next]?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (isLayoutInteraction(event)) return;
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !(event.target instanceof Element && event.target.closest('[data-search-owner="place"]'))
      ) closeSearch();
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);

  return (
    <div
      ref={root}
      className="place-search"
    >
      <form aria-label="地图地点搜索" onSubmit={(event) => {
        event.preventDefault();
        if (composing) return;
        recordSearch(query);
        setSelectedPlace(null);
        onOpen();
        setOpen(true);
        search.searchNow();
      }}>
        <input
          ref={setInput}
          className="place-search-input"
          type="search"
          aria-label="搜索地点"
          maxLength={120}
          placeholder="搜索地点"
          title={title}
          value={query}
          autoComplete="off"
          enterKeyHint="search"
          aria-controls={open ? 'place-search-results' : undefined}
          onKeyDown={navigateResults}
          onFocus={() => { onOpen(); setOpen(true); }}
          onClick={() => { onOpen(); setOpen(true); }}
          onChange={(event) => { setQuery(event.target.value); setSelectedPlace(null); setListExpanded(false); setOpen(true); }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
        />
        {query && <button type="button" className="place-search-clear" aria-label="清空地点搜索" onClick={() => {
          setQuery('');
          setSelectedPlace(null);
          setListExpanded(false);
          setFiltersOpen(false);
          search.resetOptions();
          input?.focus();
        }}><X size={14} /></button>}
        <button type="submit" className="icon-button" aria-label="搜索地点并显示结果"><Search size={17} /></button>
      </form>
      {open && <FloatingSearch
        anchor={input}
        owner="place"
        scrollable
        desktop={desktopShell}
        maxHeight={selectedPlace ? 240 : historyView ? historyHeight : listExpanded ? 450 : 340}
        expandToViewport={selectedPlace !== null || listExpanded}
      >
        <dialog open
          id="place-search-results"
          className="place-search-results glass suggestion-surface"
          aria-modal={false}
          data-app-back="50"
          aria-label="地点搜索结果"
          onKeyDown={navigateResults}
        >
          <div className="place-search-heading">
            <span className="place-search-heading-title">{selectedPlace ? '已选地点' : historyView ? '搜索记录' : <>{'\u5730\u70b9\u641c\u7d22'} · {'\u5df2\u8f7d'} {search.places.length} {'\u6761'}</>}</span>
            <div className="place-search-heading-actions">
              {!historyView && !selectedPlace && <>
                <button type="button" className="place-search-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
                  <SlidersHorizontal size={14} /><span>{'\u7b5b\u9009'}</span>
                </button>
                <button type="button" className="place-search-expand-toggle" aria-label={listExpanded ? '\u6536\u8d77\u5217\u8868' : '\u5c55\u5f00\u5217\u8868'} aria-expanded={listExpanded} onClick={() => setListExpanded((value) => !value)}>
                  {listExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span>{listExpanded ? '\u6536\u8d77' : '\u5c55\u5f00'}</span>
                </button>
              </>}
              <button type="button" aria-label={'\u5173\u95ed\u5730\u70b9\u641c\u7d22'} onClick={closeSearch}><X size={16} /></button>
            </div>
          </div>
          {selectedPlace ? <SelectedPlaceCard place={selectedPlace}
            onNavigate={onNavigate ? (place) => { recordSearch(query); closeSearch(); input?.blur(); onNavigate(place); } : undefined}
            onShare={(place) => { recordSearch(query); closeSearch(); input?.blur(); onShare(place); }}
            onReturn={() => setSelectedPlace(null)}
          /> : historyView ? <SearchHistoryList
            entries={history.entries}
            onRestore={(savedQuery) => { setSelectedPlace(null); setQuery(savedQuery); setOpen(true); input?.focus(); }}
            onRemove={history.remove}
            onClear={history.clear}
          /> : <>
          {filtersOpen && <SearchOptions
            source={search.source} onSourceChange={search.setSource}
            city={search.city} onCityChange={search.setCity}
            nationwide={search.nationwide} onNationwideChange={search.setNationwide}
          />}
          <div className="place-search-options">
            <PlaceResultList places={search.places} query={query} near={center} onExpandDetail={() => setListExpanded(true)} onNavigate={onNavigate ? (place) => {
              history.record(query.trim()); closeSearch(); input?.blur(); onNavigate(place);
            } : undefined} onSelect={(place) => {
              recordSearch(query); setSelectedPlace(place); setListExpanded(false); setFiltersOpen(false); onSelect(place);
            }} onShare={(place) => { recordSearch(query); closeSearch(); input?.blur(); onShare(place); }} />
            <SearchFeedback
              error={search.error} busy={search.busy} warnings={search.warnings}
              suggestions={search.suggestions}
              onSuggestion={(suggestion) => {
                setQuery(suggestion.query);
                setSelectedPlace(null);
                setOpen(true);
                recordSearch(suggestion.query);
                search.setCity(suggestion.city ?? '');
                search.searchNow();
              }}
              hasResults={search.places.length > 0}
            />
            {query.trim().length === 1 && <p>请再输入一个字以开始搜索。</p>}
          </div>
          <SearchFooter loadedCount={search.places.length} hasMore={!!search.next} busy={search.busy} onLoadMore={search.loadMore} source={search.source} />
          </>}
        </dialog>
      </FloatingSearch>}
    </div>
  );
}
