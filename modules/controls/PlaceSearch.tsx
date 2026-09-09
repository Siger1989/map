import { FloatingSearch } from '../input/FloatingSearch';
import { useEffect, useRef, useState } from 'react';
import { Search, X, MapPin } from 'lucide-react';
import { searchPlaces } from '../navigation/provider';
import type { Coordinate, RoutePlace } from '../navigation/types';
import { useMapPlaceLabel } from './PlaceName';

export function PlaceSearch({
  center,
  zoom,
  onOpen,
  onSelect,
}: {
  center: Coordinate | null;
  zoom: number;
  onOpen: () => void;
  onSelect: (place: RoutePlace) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [results, setResults] = useState<RoutePlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const near = useRef(center);
  near.current = center;
  const { label, title } = useMapPlaceLabel(center, zoom);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target) &&
        !(
          event.target instanceof Element &&
          event.target.closest('[data-search-owner="place"]')
        )
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [open]);

  useEffect(() => {
    setResults([]);
    setMessage('');
    setBusy(false);
    if (!open || composing || query.trim().length < 2) return;
    const controller = new AbortController();
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchPlaces(
          query,
          near.current ?? [0, 20],
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setResults(found);
          if (!found.length) setMessage('未找到地点，试试完整地名或加上城市。');
        }
      } catch {
        if (!controller.signal.aborted)
          setMessage('搜索暂不可用，请检查网络后重新搜索。');
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, composing, revision]);

  return (
    <div
      ref={root}
      className="place-search"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          input.current?.focus();
          setOpen(false);
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const buttons = Array.from(
            document.querySelectorAll<HTMLButtonElement>(
              '[data-search-owner="place"] [data-place-result]',
            ) ?? [],
          );
          if (!buttons.length) return;
          event.preventDefault();
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === 'ArrowDown'
              ? (current + 1) % buttons.length
              : current <= 0
                ? buttons.length - 1
                : current - 1;
          buttons[next]?.focus();
        }
      }}
    >
      <form
        role="search"
        aria-label="地图地点搜索"
        onSubmit={(event) => {
          event.preventDefault();
          if (composing) return;
          onOpen();
          setOpen(true);
          setRevision((n) => n + 1);
        }}
      >
        <input
          ref={input}
          type="search"
          aria-label="搜索地点"
          maxLength={120}
          placeholder={`搜索地点 · ${label}`}
          title={title}
          value={query}
          autoComplete="off"
          enterKeyHint="search"
          aria-controls={open ? 'place-search-results' : undefined}
          onFocus={() => {
            onOpen();
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
        />
        {query && (
          <button
            type="button"
            className="place-search-clear"
            aria-label="清空地点搜索"
            onClick={() => {
              setQuery('');
              input.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
        <button
          type="submit"
          className="icon-button"
          aria-label="搜索地点并显示结果"
        >
          <Search size={17} />
        </button>
      </form>
      {open && (
        <FloatingSearch anchor={input.current} owner="place">
          <section
            id="place-search-results"
            className="place-search-results glass suggestion-surface"
            aria-label="地点搜索结果"
          >
            <div className="place-search-heading">
              <span>地点搜索</span>
              <button
                type="button"
                aria-label="关闭地点搜索"
                onClick={() => setOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="place-search-options">
              {results.map((place, index) => (
                <button
                  type="button"
                  data-place-result
                  key={`${place.coordinates.join(',')}-${index}`}
                  onClick={() => {
                    onSelect(place);
                    setOpen(false);
                    setQuery('');
                    input.current?.blur();
                  }}
                >
                  <MapPin size={15} />
                  <span>
                    <strong>{place.name}</strong>
                    <small>
                      {place.detail ||
                        `${place.coordinates[1].toFixed(4)}, ${place.coordinates[0].toFixed(4)}`}
                    </small>
                  </span>
                </button>
              ))}
              {!results.length && (
                <p role="status">
                  {busy
                    ? '正在搜索…'
                    : message ||
                      (query.trim().length === 1
                        ? '请输入至少两个字。'
                        : '输入城市、街道或山峰名称。')}
                </p>
              )}
            </div>
            <small className="place-search-credit">
              Photon / OpenStreetMap
            </small>
          </section>
        </FloatingSearch>
      )}
    </div>
  );
}
