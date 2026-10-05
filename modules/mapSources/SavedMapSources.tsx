import { useEffect, useMemo, useState } from 'react';
import type { MapSource } from './types';
import './savedMapSources.css';
import { getMapSourcesSessionState, updateMapSourcesSessionState, type SavedSourceFilter } from './sessionState';
import { readFavoriteSourceKeys, savedMapSourceFavoriteKey, subscribeFavoriteSourceKeys, writeFavoriteSourceKeys } from './favorites';

type Filter = SavedSourceFilter;

export function SavedMapSources({
  maps,
  selected,
  ready,
  busy,
  onSelect,
  onRemove,
  onAdd,
}: {
  maps: MapSource[];
  selected: string;
  ready: boolean;
  busy: boolean;
  onSelect: (map: MapSource) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState(() => getMapSourcesSessionState().savedQuery);
  const [filter, setFilter] = useState<Filter>(() => getMapSourcesSessionState().savedFilter);
  const [confirming, setConfirming] = useState('');
  const [favoriteKeys, setFavoriteKeys] = useState(() => readFavoriteSourceKeys());
  const [favoriteError, setFavoriteError] = useState(false);
  const favorites = useMemo(() => new Set(favoriteKeys), [favoriteKeys]);

  useEffect(() => subscribeFavoriteSourceKeys(setFavoriteKeys), []);

  useEffect(() => {
    if (!ready) return;
    const available = new Set(maps.map(map => map.id));
    const next = favoriteKeys.filter(key => !key.startsWith('saved:') || available.has(key.slice('saved:'.length)));
    if (next.length !== favoriteKeys.length) {
      setFavoriteKeys(next);
      writeFavoriteSourceKeys(next);
    }
  }, [favoriteKeys, maps, ready]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return maps.filter((map) => {
        const online = map.kind === 'online';
        const matchesKind = filter === 'all' || filter === 'favorites' || (filter === 'online' ? online : !online);
        return (
          matchesKind && (filter !== 'favorites' || favorites.has(savedMapSourceFavoriteKey(map.id))) &&
          (!needle || map.name.toLocaleLowerCase().includes(needle))
        );
      });
  }, [favorites, filter, maps, query]);
  const groups = useMemo(() => ({
    common: filtered.filter(map => favorites.has(savedMapSourceFavoriteKey(map.id))),
    online: filtered.filter(map => !favorites.has(savedMapSourceFavoriteKey(map.id)) && map.kind === 'online'),
    offline: filtered.filter(map => !favorites.has(savedMapSourceFavoriteKey(map.id)) && map.kind !== 'online'),
  }), [favorites, filtered]);
  const showFavoriteHint = !query.trim() && !favoriteKeys.some(key => key.startsWith('saved:')) && (filter === 'all' || filter === 'favorites');
  const selectedMap = maps.find((map) => map.id === selected);
  const selectedHidden =
    !!selectedMap && !filtered.some((map) => map.id === selected);

  const updateQuery = (value: string) => {
    updateMapSourcesSessionState({ savedQuery: value });
    setQuery(value);
  };
  const updateFilter = (value: Filter) => {
    updateMapSourcesSessionState({ savedFilter: value });
    setFilter(value);
  };

  return (
    <section className="saved-map-sources" aria-label="我的图源">
      <header className="saved-map-sources__header">
        <h3>我的图源</h3>
        <button
          className="saved-map-sources__add"
          type="button"
          onClick={onAdd}
          disabled={!ready || busy}
        >
          ＋ 添加图源
        </button>
      </header>

      <div className="saved-map-sources__tools">
        <input
          type="search"
          aria-label="搜索图源名称"
          placeholder="搜索名称"
          value={query}
          onChange={(event) => updateQuery(event.currentTarget.value)}
        />
        <select
          aria-label="筛选图源"
          value={filter}
          onChange={(event) => updateFilter(event.currentTarget.value as Filter)}
        >
          <option value="all">全部</option>
          <option value="favorites">常用</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
        </select>
      </div>
      {favoriteError && <p className="saved-map-sources__message" role="status">常用设置未能保存</p>}

      {!ready ? (
        <p className="saved-map-sources__message" role="status">正在读取本机图源…</p>
      ) : maps.length === 0 ? (
        <div className="saved-map-sources__empty">
          <p>还没有添加图源</p>
          <button type="button" onClick={onAdd} disabled={busy}>
            添加图源
          </button>
        </div>
      ) : filtered.length === 0 && !showFavoriteHint ? (
        <div className="saved-map-sources__empty" role="status">
          <p>没有符合条件的图源</p>
          {selectedHidden && <p>当前图源“{selectedMap.name}”不在此筛选结果中。</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              updateQuery('');
              updateFilter('all');
            }}
          >
            清除筛选
          </button>
        </div>
      ) : (
        <>
          {selectedHidden && (
            <p className="saved-map-sources__message" role="status">
              当前图源“{selectedMap.name}”不在此筛选结果中。
            </p>
          )}
          {(['common', 'online', 'offline'] as const).map(group => {
            const title = group === 'common' ? '常用' : group === 'online' ? '在线' : '离线';
            const items = groups[group];
            if (!items.length && !(group === 'common' && showFavoriteHint)) return null;
            return <section className="saved-map-sources__group" data-group={group} aria-label={`${title}图源`} key={group}>
              <h4>{title}</h4>
              {!items.length && group === 'common' && showFavoriteHint ? <small className="saved-map-sources__favorite-hint">点☆加入常用</small> : <ul className="saved-map-sources__list">
            {items.map((map) => {
              const isSelected = map.id === selected;
              const isConfirming = confirming === map.id;
              const favoriteKey = savedMapSourceFavoriteKey(map.id);
              const isFavorite = favorites.has(favoriteKey);
              return (
                <li className="saved-map-sources__item" key={map.id} data-group={group}>
                  <button
                    className="saved-map-sources__choice"
                    type="button"
                    aria-pressed={isSelected}
                    title={map.name}
                    disabled={busy}
                    onClick={() => onSelect(map)}
                  >
                    <span className="saved-map-sources__name">{map.name}</span>
                  </button>
                  {!isConfirming && <button
                    className="saved-map-sources__favorite"
                    type="button"
                    aria-label={`${isFavorite ? '移出' : '加入'}常用：${map.name}`}
                    aria-pressed={isFavorite}
                    title={isFavorite ? '移出常用' : '加入常用'}
                    disabled={busy}
                    onClick={() => {
                      const next = isFavorite ? favoriteKeys.filter(key => key !== favoriteKey) : [...favoriteKeys, favoriteKey];
                      if (writeFavoriteSourceKeys(next)) {
                        setFavoriteKeys(next);
                        setFavoriteError(false);
                      } else {
                        setFavoriteError(true);
                      }
                    }}
                  >{isFavorite ? '★' : '☆'}</button>}
                  {isConfirming ? (
                    <div className="saved-map-sources__confirm" aria-label={`确认移除${map.name}`}>
                      <span>移除此图源？</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirming('');
                          onRemove(map.id);
                        }}
                      >
                        确认
                      </button>
                      <button type="button" onClick={() => setConfirming('')}>
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      className="saved-map-sources__remove"
                      type="button"
                      disabled={busy}
                      aria-label={`移除${map.name}`}
                      onClick={() => setConfirming(map.id)}
                    >
                      移除
                    </button>
                  )}
                </li>
              );
            })}
              </ul>}
            </section>;
          })}
        </>
      )}
    </section>
  );
}
