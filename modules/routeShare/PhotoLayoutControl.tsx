import type { TripPhoto } from '../photos/storage';
export function PhotoLayoutControl({
  photos,
  selected,
  hero,
  disabled,
  onChange,
  onHero,
}: {
  photos: TripPhoto[];
  selected: string[];
  hero: string;
  disabled: boolean;
  onChange: (ids: string[]) => void;
  onHero: (id: string) => void;
}) {
  if (!photos.length) return null;
  return (
    <details className="route-share-bundle">
      <summary>长图照片混排 · 已选{selected.length}/8</summary>
      <small>横竖照片自动并排，重点照片单独放大；保留完整画面。</small>
      <div style={{ maxHeight: 144, overflowY: 'auto' }}>
        {photos.map((p) => (
          <label
            key={p.id}
            style={{ display: 'flex', alignItems: 'center', minHeight: 36 }}
          >
            <input
              type="checkbox"
              disabled={
                disabled || (selected.length >= 8 && !selected.includes(p.id))
              }
              checked={selected.includes(p.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, p.id]
                    : selected.filter((id) => id !== p.id),
                )
              }
            />
            {p.title || p.name}
          </label>
        ))}
      </div>
      <label>
        重点照片
        <select
          disabled={disabled}
          value={selected.includes(hero) ? hero : ''}
          onChange={(e) => onHero(e.target.value)}
        >
          <option value="">不设置</option>
          {photos
            .filter((p) => selected.includes(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.title || p.name}
              </option>
            ))}
        </select>
      </label>
    </details>
  );
}
