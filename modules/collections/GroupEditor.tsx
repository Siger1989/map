import { useState } from 'react';
import { COLORS, type CollectionGroup } from './data';

export function GroupEditor({
  group,
  onSave,
  onDelete,
  onBack,
  disabled,
}: {
  group: CollectionGroup;
  onSave: (group: CollectionGroup) => void;
  onDelete?: () => void;
  onBack: () => void;
  disabled: boolean;
}) {
  const [name, setName] = useState(group.name),
    [color, setColor] = useState(group.color);
  return (
    <form
      className="collection-editor collection-scroll"
      data-collection-scroll="y"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave({ ...group, name: name.trim(), color });
      }}
    >
      <button
        type="button"
        className="collection-back"
        aria-label="返回分组"
        onClick={onBack}
      >
        ‹ 返回分组
      </button>
      <label>
        分组名称
        <input
          aria-label="分组名称"
          autoFocus
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：川藏骑行"
          required
        />
      </label>
      <fieldset>
        <legend>分组颜色</legend>
        <div className="collection-colors">
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              aria-label={c.name}
              aria-pressed={color === c.value}
              onClick={() => setColor(c.value)}
            >
              <i style={{ background: c.value }} />
              {color === c.value && <span>✓</span>}
            </button>
          ))}
        </div>
      </fieldset>
      <button
        className="collection-primary"
        disabled={disabled || !name.trim()}
        type="submit"
      >
        保存分组
      </button>
      {onDelete && (
        <button
          className="collection-delete"
          disabled={disabled}
          type="button"
          onClick={onDelete}
        >
          删除分组，路线移至未分组
        </button>
      )}
    </form>
  );
}
