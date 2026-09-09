import { SmartInput, SmartTextarea } from '../input/SmartText';
import { useState, type ReactNode } from 'react';
import type { Annotation } from './data';
import { MARKER_ICONS, markerIcon } from './icons';
import {
  MAX_ATTRIBUTES,
  readAttributeTemplate,
  ATTRIBUTE_TEMPLATE_KEY,
} from './attributes';

export function AnnotationIdentity({
  item,
  change,
  remember,
  location,
}: {
  item: Pick<Annotation, 'name' | 'attributes' | 'icon'>;
  change: (
    patch: Partial<Pick<Annotation, 'name' | 'attributes' | 'icon'>>,
  ) => boolean;
  remember: () => void;
  location?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [recent] = useState(() => {
    try {
      return readAttributeTemplate(localStorage.getItem(ATTRIBUTE_TEMPLATE_KEY))
        .recent;
    } catch {
      return [];
    }
  });
  const fields = item.attributes ?? [];
  return (
    <>
      <button
        className="annotation-logo-current"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <svg viewBox="0 0 24 24" width="25" height="25" aria-hidden="true">
          <path d={markerIcon(item.icon).path} />
        </svg>
        图标 · {markerIcon(item.icon).name}
        <span>更换 ▾</span>
      </button>
      {expanded && (
        <div className="annotation-logo-grid" aria-label="标记图标">
          {Object.entries(MARKER_ICONS).map(([id, icon]) => (
            <button
              key={id}
              aria-label={`图标 ${icon.name}`}
              aria-pressed={(item.icon ?? 'pin') === id}
              onClick={() => {
                change({ icon: id as Annotation['icon'] });
                setExpanded(false);
              }}
            >
              <svg
                viewBox="0 0 24 24"
                width="23"
                height="23"
                aria-hidden="true"
              >
                <path d={icon.path} />
              </svg>
              <small>{icon.name}</small>
            </button>
          ))}
        </div>
      )}
      <label className="annotation-field">
        <span>名称</span>
        <SmartInput
          aria-label="标记名称"
          value={item.name}
          maxLength={60}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>
      {location}
      <div className="annotation-attributes" aria-label="自定义属性">
        <span className="annotation-attribute-head">
          属性条目 <span>具体数据</span>
        </span>
        {fields.map((f, i) => (
          <div className="annotation-attribute-row" key={i}>
            <SmartInput
              aria-label={`属性 ${i + 1} 名称`}
              placeholder="条目名"
              suggestions={recent}
              maxLength={60}
              value={f.name}
              onBlur={remember}
              onChange={(e) =>
                change({
                  attributes: fields.map((v, n) =>
                    n === i ? { ...v, name: e.target.value } : v,
                  ),
                })
              }
            />
            <SmartTextarea
              rows={1}
              aria-label={`属性 ${i + 1} 数据`}
              placeholder="具体数据"
              maxLength={2000}
              value={f.value}
              onChange={(e) =>
                change({
                  attributes: fields.map((v, n) =>
                    n === i ? { ...v, value: e.target.value } : v,
                  ),
                })
              }
            />
            <button
              aria-label={`删除属性 ${i + 1}`}
              onClick={() => {
                if (change({ attributes: fields.filter((_, n) => n !== i) }))
                  remember();
              }}
            >
              ×
            </button>
          </div>
        ))}
        <datalist id="annotation-recent-fields">
          {recent.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <button
          disabled={fields.length >= MAX_ATTRIBUTES}
          onClick={() =>
            change({ attributes: [...fields, { name: '', value: '' }] })
          }
        >
          ＋ 属性条目
        </button>
      </div>
    </>
  );
}
