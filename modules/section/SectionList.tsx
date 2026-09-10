import { SmartInput } from '../input/SmartText';
import { Eye, EyeOff, Trash2, X, Plus } from 'lucide-react';
import type { SectionObjectsState } from './useSavedSection';
import './sectionList.css';
import { surveyBasis } from './surveyLine';
export function SectionList({
  state,
  onCreate,
  onSelect,
  onClose,
}: {
  state: SectionObjectsState;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="section-list glass" aria-label="剖面列表">
      <header>
        <strong>剖面 · {state.items.length}</strong>
        <button onClick={onCreate} disabled={!state.ready}>
          <Plus size={16} />
          新建
        </button>
        <button onClick={onClose} aria-label="关闭剖面列表">
          <X size={18} />
        </button>
      </header>
      <div className="section-list-body">
        {!state.items.length && (
          <p>
            新建后在地图或已有标记中选
            A、B，确定勘探线。保存的剖面也在收藏夹中。
          </p>
        )}
        {state.items.map((item) => (
          <div className="section-list-row" key={item.id}>
            <div>
              <SmartInput
                aria-label={`名称 ${item.name}`}
                key={item.name}
                defaultValue={item.name}
                maxLength={60}
                onBlur={(e) => state.rename(item.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
              <small>
                {Math.round(item.settings.plane!.width)}米 ·{' '}
                {Math.round(
                  item.settings.survey
                    ? surveyBasis(item.settings.survey).bearing
                    : item.settings.plane!.heading,
                )}
                °
              </small>
            </div>
            <button
              onClick={() => onSelect(item.id)}
              aria-label={`查看剖面 ${item.name}`}
              aria-pressed={state.selectedId === item.id}
            >
              查看
            </button>
            <button
              onClick={() => state.toggle(item.id)}
              aria-label={`${item.settings.enabled ? '隐藏' : '显示'} ${item.name}`}
            >
              {item.settings.enabled ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
            <button
              onClick={() => state.remove(item.id)}
              aria-label={`删除剖面 ${item.name}`}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
        {state.canUndoDelete && (
          <button className="section-list-undo" onClick={state.undoDelete}>
            撤销删除
          </button>
        )}
        {state.error && <p role="alert">{state.error}</p>}
      </div>
    </section>
  );
}
