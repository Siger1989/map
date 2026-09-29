import { useMemo, useState } from 'react';
import type { MapSource } from './types';
import './savedMapSources.css';
import { getMapSourcesSessionState, updateMapSourcesSessionState, type SavedSourceFilter } from './sessionState';

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

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return maps.filter((map) => {
        const online = map.kind === 'online';
        return (
          (filter === 'all' || (filter === 'online' ? online : !online)) &&
          (!needle || map.name.toLocaleLowerCase().includes(needle))
        );
      });
  }, [filter, maps, query]);
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
          <option value="online">在线</option>
          <option value="offline">离线</option>
        </select>
      </div>

      {!ready ? (
        <p className="saved-map-sources__message" role="status">正在读取本机图源…</p>
      ) : maps.length === 0 ? (
        <div className="saved-map-sources__empty">
          <p>还没有添加图源</p>
          <button type="button" onClick={onAdd} disabled={busy}>
            添加图源
          </button>
        </div>
      ) : filtered.length === 0 ? (
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
          <ul className="saved-map-sources__list">
            {filtered.map((map) => {
              const isSelected = map.id === selected;
              const isConfirming = confirming === map.id;
              return (
                <li className="saved-map-sources__item" key={map.id}>
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
          </ul>
        </>
      )}
    </section>
  );
}
