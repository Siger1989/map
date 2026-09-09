import { FloatingSearch } from '../input/FloatingSearch';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  ArrowDownUp,
  MapPin,
  Search,
  GripVertical,
  Plus,
  X,
} from 'lucide-react';
import { searchPlaces } from './provider';
import { MAX_ROUTE_STOPS, stopLabel } from './stops';
import {
  formatDistance,
  formatDuration,
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
}) {
  const [active, setActive] = useState<string | null>(null),
    [results, setResults] = useState<RoutePlace[]>([]),
    [searching, setSearching] = useState(false),
    [searchError, setSearchError] = useState(''),
    [composing, setComposing] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [target, setTarget] = useState<number | null>(null),
    [dragging, setDragging] = useState<string | null>(null),
    [announcement, setAnnouncement] = useState('');
  const rows = useRef<HTMLDivElement>(null),
    request = useRef<AbortController | null>(null),
    drag = useRef<{
      id: string;
      pointer: number;
      to: number;
      y: number;
      frame: number;
    } | null>(null);
  const previousCount = useRef(n.stops.length);
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
  const pickingIndex =
    n.picking === 'start'
      ? 0
      : n.picking === 'end'
        ? n.stops.length - 1
        : n.picking;
  useEffect(() => {
    if (pickingIndex === null) return;
    rows.current
      ?.querySelector<HTMLElement>(
        `[data-stop-id="${n.stops[pickingIndex]?.id}"]`,
      )
      ?.scrollIntoView({ block: 'nearest' });
  }, [pickingIndex]);
  const nearRef = useRef(near);
  nearRef.current = near;
  useEffect(() => {
    request.current?.abort();
    setResults([]);
    setSearchError('');
    setSearching(false);
    if (
      !selected ||
      selected.place ||
      selected.query.trim().length < 2 ||
      composing
    )
      return;
    const abort = new AbortController();
    request.current = abort;
    const timer = setTimeout(
      async () => {
        setSearching(true);
        try {
          const found = await searchPlaces(
            selected.query,
            nearRef.current,
            abort.signal,
          );
          if (!abort.signal.aborted) {
            setResults(found);
            if (!found.length)
              setSearchError('未找到地点，可点定位图标在地图选点。');
          }
        } catch (e) {
          if (!abort.signal.aborted)
            setSearchError(
              e instanceof Error &&
                !['TypeError', 'TimeoutError'].includes(e.name)
                ? e.message
                : '搜索暂不可用，可在地图选点。',
            );
        } finally {
          if (!abort.signal.aborted) setSearching(false);
        }
      },
      refresh ? 200 : 900,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [active, selected?.query, selected?.place, composing, refresh]);
  useEffect(
    () => () => {
      if (drag.current) cancelAnimationFrame(drag.current.frame);
    },
    [],
  );
  const search = (id: string) => {
    setActive(id);
    setRefresh((v) => v + 1);
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
    request.current?.abort();
    setActive(null);
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
  return (
    <div className="route-panel" data-picking={n.picking !== null}>
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
      <div ref={rows} className="route-stop-list">
        {n.stops.map((s, index) => {
          const label = stopLabel(index, n.stops.length),
            focused = active === s.id;
          return (
            <div
              key={s.id}
              data-stop-id={s.id}
              className={`route-stop-block ${pickingIndex === index ? 'is-picking' : ''} ${dragging === s.id ? 'is-dragging' : ''} ${dragging && target === index ? 'is-drop-target' : ''}`}
            >
              <form
                className="route-stop-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  search(s.id);
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
                <input
                  aria-label={label}
                  autoComplete="off"
                  enterKeyHint="search"
                  placeholder={`输入${label}`}
                  value={s.query}
                  maxLength={120}
                  onFocus={() => {
                    n.setPicking(null);
                    setActive(s.id);
                  }}
                  onCompositionStart={() => setComposing(true)}
                  onCompositionEnd={() => setComposing(false)}
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
                    request.current?.abort();
                    setActive(null);
                    setResults([]);
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
                      request.current?.abort();
                      setActive(null);
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
                      request.current?.abort();
                      setActive(null);
                      n.remove(index);
                      setAnnouncement(`已删除${label}`);
                    }}
                  >
                    <X size={18} />
                  </button>
                )}
              </form>
              {focused && (
                <div className="stop-edit-options">
                  <button
                    disabled={
                      searching || s.query.trim().length < 2 || !!s.place
                    }
                    onClick={() => search(s.id)}
                  >
                    <Search size={13} />
                    {searching ? '搜索中…' : '搜索'}
                  </button>
                  {s.query && (
                    <button onClick={() => n.edit(index, '')}>清空</button>
                  )}
                  <button
                    aria-label={`完成编辑${label}`}
                    onClick={() => {
                      setActive(null);
                      (document.activeElement as HTMLElement)?.blur();
                    }}
                  >
                    <X size={13} />
                    收起
                  </button>
                </div>
              )}
              {focused && searchError && (
                <p role="status" className="route-error">
                  {searchError}
                </p>
              )}
              {focused && !!results.length && (
                <FloatingSearch
                  owner="route"
                  anchor={
                    rows.current?.querySelector<HTMLElement>(
                      `[data-stop-id="${s.id}"] input`,
                    ) ?? null
                  }
                >
                  <div className="floating-search-heading">
                    <strong>
                      {label}搜索结果 · {results.length}
                    </strong>
                    <button
                      aria-label="关闭路线搜索结果"
                      onClick={() => setActive(null)}
                    >
                      ×
                    </button>
                  </div>
                  <ul
                    className="route-search-results suggestion-surface"
                    aria-label={`${label}搜索结果`}
                  >
                    {results.map((p, i) => (
                      <li key={i}>
                        <button
                          onClick={() => {
                            request.current?.abort();
                            n.place(index, p);
                            onPlace(p);
                            setResults([]);
                            setActive(null);
                          }}
                        >
                          <strong>{p.name}</strong>
                          <small>{p.detail}</small>
                        </button>
                      </li>
                    ))}
                  </ul>
                </FloatingSearch>
              )}
            </div>
          );
        })}
      </div>
      <span className="route-sort-status" role="status">
        {announcement}
      </span>
      <div className="route-edit-actions">
        <button
          disabled={n.stops.length >= MAX_ROUTE_STOPS}
          onClick={() => {
            setActive(null);
            n.add();
          }}
        >
          <Plus size={14} />
          途经点
        </button>
        <button disabled={locating} onClick={onCurrentPosition}>
          {locating ? '定位中…' : '我的位置'}
        </button>
        <button
          onClick={() => {
            setActive(null);
            n.swap();
          }}
        >
          <ArrowDownUp size={13} />
          反向
        </button>
        <button
          onClick={() => {
            setActive(null);
            n.clear();
          }}
        >
          清除
        </button>
      </div>
      <button
        className="route-primary"
        disabled={n.loading}
        onClick={async () => {
          const missing = n.stops.find((s) => !s.place);
          setActive(missing?.id ?? null);
          const route = await n.calculate();
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
      {n.stops.some((s) => !s.place) && (
        <p className="route-note">
          输入地名后选搜索结果，或点“选点”后点击已有标记或地图空白处。
        </p>
      )}
      {n.route && (
        <>
          <div className="route-result">
            <strong>{formatDistance(n.route.distance)}</strong>
            <span>{formatDuration(n.route.duration)}</span>
            <button onClick={() => onShow(n.route!)}>看全程</button>
            <button onClick={onSave}>收藏路线</button>
            <button onClick={onShare}>分享路线</button>
          </div>
          <button
            className="route-start-navigation"
            onClick={onStartNavigation}
            disabled={navigating}
          >
            {navigating ? '正在导航' : '开始导航'}
          </button>
          {guidanceError && !navigating && (
            <p className="route-error" role="alert">
              {guidanceError}
            </p>
          )}
          {saveMessage && (
            <p className="route-note" role="status">
              {saveMessage}
            </p>
          )}
          {!!n.route.accessDistance && (
            <p className="route-note">
              虚线为选点与附近道路的直连接入，共{' '}
              {Math.round(n.route.accessDistance)}{' '}
              米，已计入总长；时间按步行估算，实际通行需现场确认。
            </p>
          )}
          <details className="route-steps">
            <summary>转向与路段 · {n.route.steps.length} 步</summary>
            <ol>
              {n.route.steps.map((s, i) => (
                <li key={i}>
                  {s.instruction}
                  <small>{formatDistance(s.distance)}</small>
                </li>
              ))}
            </ol>
          </details>
        </>
      )}
      <details className="route-provider-note">
        <summary>使用说明与数据来源</summary>
        <p className="route-note">
          在地点栏输入后选择搜索结果，或点定位图标在地图选点。最多 8
          个途经点；拖右侧柄调整所有地点顺序，修改后重新规划。公共道路服务不含实时路况，天气为模型预报。
        </p>
        <p className="route-note">
          <a
            href="https://valhalla.openstreetmap.de/"
            target="_blank"
            rel="noreferrer"
          >
            FOSSGIS / Valhalla
          </a>{' '}
          ·{' '}
          <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">
            Photon 地名搜索
          </a>{' '}
          · © OpenStreetMap
        </p>
      </details>
    </div>
  );
}
