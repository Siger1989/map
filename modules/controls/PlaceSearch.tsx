import { isLayoutInteraction } from '../uiLayout/events';
import { FloatingSearch } from '../input/FloatingSearch';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Search, SlidersHorizontal, X } from 'lucide-react';
import type { Coordinate, RoutePlace } from '../navigation/types';
import { isDesktopShell } from '../platform/desktop';
import { useMapPlaceLabel } from './PlaceName';
import { usePlaceSearch } from '../navigation/usePlaceSearch';
import { SearchOptions } from '../navigation/SearchOptions';
import { PlaceResultList, SearchFeedback, SearchFooter } from '../navigation/SearchFeedback';

export function PlaceSearch({
  center,
  zoom,
  onOpen,
  onSelect,
  onShare,
}: {
  center: Coordinate | null;
  zoom: number;
  onOpen: () => void;
  onSelect: (place: RoutePlace) => void;
  onShare: (place: RoutePlace) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [composing, setComposing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<HTMLInputElement | null>(null);
  const desktopShell = isDesktopShell();
  const search = usePlaceSearch({ query, enabled: open, composing, near: center });
  const { title } = useMapPlaceLabel(center, zoom);
  const closeSearch = () => { setOpen(false); setListExpanded(false); setFiltersOpen(false); };

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
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
        />
        {query && <button type="button" className="place-search-clear" aria-label="清空地点搜索" onClick={() => {
          setQuery('');
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
        maxHeight={listExpanded ? 340 : 205}
        expandToViewport={listExpanded}
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
            <span className="place-search-heading-title">{'\u5730\u70b9\u641c\u7d22'} · {'\u5df2\u8f7d'} {search.places.length} {'\u6761'}</span>
            <div className="place-search-heading-actions">
              <button type="button" className="place-search-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>
                <SlidersHorizontal size={14} /><span>{'\u7b5b\u9009'}</span>
              </button>
              <button type="button" className="place-search-expand-toggle" aria-label={listExpanded ? '\u6536\u8d77\u5217\u8868' : '\u5c55\u5f00\u5217\u8868'} aria-expanded={listExpanded} onClick={() => setListExpanded((value) => !value)}>
                {listExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}<span>{listExpanded ? '\u6536\u8d77' : '\u5c55\u5f00'}</span>
              </button>
              <button type="button" aria-label={'\u5173\u95ed\u5730\u70b9\u641c\u7d22'} onClick={closeSearch}><X size={16} /></button>
            </div>
          </div>
          {filtersOpen && <SearchOptions
            source={search.source} onSourceChange={search.setSource}
            city={search.city} onCityChange={search.setCity}
            nationwide={search.nationwide} onNationwideChange={search.setNationwide}
          />}
          <div className="place-search-options">
            <PlaceResultList places={search.places} query={query} near={center} onSelect={(place) => {
              onSelect(place); closeSearch(); setQuery(''); input?.blur();
            }} onShare={(place) => { closeSearch(); input?.blur(); onShare(place); }} />
            <SearchFeedback
              error={search.error} busy={search.busy} warnings={search.warnings}
              suggestions={search.suggestions}
              onSuggestion={(suggestion) => {
                setQuery(suggestion.query);
                setOpen(true);
                search.setCity(suggestion.city ?? '');
                search.searchNow();
              }}
              hasResults={search.places.length > 0}
            />
            {!query.trim() && <p>输入街道、门牌、地点或行政区名称。</p>}
            {query.trim().length === 1 && <p>请再输入一个字以开始搜索。</p>}
          </div>
          <SearchFooter loadedCount={search.places.length} hasMore={!!search.next} busy={search.busy} onLoadMore={search.loadMore} source={search.source} />
        </dialog>
      </FloatingSearch>}
    </div>
  );
}
