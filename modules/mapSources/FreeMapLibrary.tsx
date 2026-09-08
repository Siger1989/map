import { useState } from 'react';
import { FREE_MAPS, freeMap } from './presets';
import type { Bounds } from './types';
export function FreeMapLibrary({
  selected,
  onSelect,
  onFocus,
}: {
  selected: string;
  onSelect: (id: string) => void;
  onFocus: (b: Bounds) => void;
}) {
  const [category, setCategory] = useState('全球');
  const active = freeMap(selected);
  return (
    <section className="free-map-library" aria-label="免费图源库">
      <header>
        <strong>免费图源 · {FREE_MAPS.length} 种</strong>
        <small>免密钥 · 联网</small>
      </header>
      <div className="free-map-tabs" role="group" aria-label="图源覆盖区域">
        {['全球', '美国', '日本'].map((c) => (
          <button
            key={c}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="free-map-grid">
        {FREE_MAPS.filter((m) => m.category === category).map((m) => (
          <button
            key={m.id}
            aria-pressed={m.id === selected}
            onClick={() => onSelect(m.id)}
          >
            <strong>{m.name}</strong>
            <small>
              {m.id === selected ? '当前使用' : `最高 ${m.maxzoom} 级`}
            </small>
          </button>
        ))}
      </div>
      {active && (
        <div className="free-map-info">
          <p>
            {active.name} · {active.detail}
          </p>
          <a href={active.terms} target="_blank" rel="noreferrer">
            来源与使用说明
          </a>
          {active.bounds && (
            <button onClick={() => onFocus(active.bounds!)}>
              查看覆盖区域
            </button>
          )}
        </div>
      )}
      <small>
        公共服务可能限流。切换保留当前视角；区域图源请在覆盖地区查看。天地图等需自有Key的图源可通过“添加”配置。
      </small>
    </section>
  );
}
export function FreeMapCredit({ id }: { id: string }) {
  const source = freeMap(id);
  return source ? (
    <a
      className="map-source-credit"
      href={source.creditUrl}
      target="_blank"
      rel="noreferrer"
    >
      {source.attribution}
    </a>
  ) : null;
}
