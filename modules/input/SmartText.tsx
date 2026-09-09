import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEventHandler,
  type InputHTMLAttributes,
  type KeyboardEventHandler,
  type Ref,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import {
  rankSuggestions,
  readSuggestionHistory,
  suggestionGroup,
} from './suggestions';
import './suggestions.css';
export const TextSuggestions = createContext<Record<string, string[]>>({});
type FieldProps<T> = {
  suggestions?: string[];
  value?: string | number | readonly string[];
  placeholder?: string;
  'aria-label'?: string;
  onFocus?: FocusEventHandler<T>;
  onBlur?: FocusEventHandler<T>;
  onKeyDown?: KeyboardEventHandler<T>;
};
function useSuggestions<T extends HTMLInputElement | HTMLTextAreaElement>(
  props: FieldProps<T>,
  external: Ref<T>,
) {
  const input = useRef<T | null>(null),
    id = useId(),
    pool = useContext(TextSuggestions);
  const [open, setOpen] = useState(false),
    [composing, setComposing] = useState(false),
    [index, setIndex] = useState(-1),
    [history, setHistory] = useState<string[]>([]);
  const [style, setStyle] = useState<CSSProperties>({});
  const [fieldLabel, setFieldLabel] = useState(
    props['aria-label'] || props.placeholder || '文字输入',
  );
  const label = props['aria-label'] || fieldLabel,
    group = suggestionGroup(label),
    key = `shantu.input-history.v1:${group}`;
  const values = rankSuggestions(String(props.value ?? ''), [
    ...(props.suggestions ?? []),
    ...history,
    ...(pool[group] ?? []),
    ...(group === 'attribute' ? ['类型', '路况', '补给', '说明'] : []),
  ]);
  const remember = (value: string) => {
    if (!value.trim() || value.length > 300) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify(
          [value, ...history.filter((v) => v !== value)].slice(0, 12),
        ),
      );
    } catch {}
  };
  const choose = (value: string) => {
    const node = input.current;
    if (!node) return;
    const prototype =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
    remember(value);
    setOpen(false);
    node.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const r = input.current?.getBoundingClientRect();
      if (!r) return;
      const v = window.visualViewport,
        bottom = (v?.offsetTop ?? 0) + (v?.height ?? innerHeight),
        left = Math.max(6, r.left),
        width = Math.min(Math.max(180, r.width), innerWidth - left - 6);
      const below = bottom - r.bottom,
        height = Math.min(190, Math.max(below, r.top - 6));
      setStyle({
        left,
        width,
        top: below >= 140 ? r.bottom + 3 : Math.max(6, r.top - height - 3),
        maxHeight: Math.max(50, height),
      });
    };
    update();
    window.addEventListener('resize', update);
    document.addEventListener('scroll', update, true);
    window.visualViewport?.addEventListener('resize', update);
    const dismiss = (e: PointerEvent) => {
      if (
        e.target instanceof Element &&
        e.target !== input.current &&
        !e.target.closest(`[data-suggestion-owner="${CSS.escape(id)}"]`)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => {
      window.removeEventListener('resize', update);
      document.removeEventListener('scroll', update, true);
      window.visualViewport?.removeEventListener('resize', update);
      document.removeEventListener('pointerdown', dismiss, true);
    };
  }, [open, id, props.value]);
  return {
    ref: (node: T | null) => {
      input.current = node;
      if (typeof external === 'function') external(node);
      else if (external) external.current = node;
    },
    bind: {
      autoComplete: 'off',
      role: 'combobox',
      'aria-autocomplete': 'list' as const,
      'aria-expanded': open,
      'aria-controls': open ? id : undefined,
      'aria-activedescendant':
        open && index >= 0 ? `${id}-${index}` : undefined,
      onFocus: ((e) => {
        props.onFocus?.(e);
        const actualLabel =
          props['aria-label'] ||
          e.currentTarget.labels?.[0]?.textContent?.trim() ||
          props.placeholder ||
          '文字输入';
        setFieldLabel(actualLabel);
        try {
          setHistory(
            readSuggestionHistory(
              localStorage.getItem(
                `shantu.input-history.v1:${suggestionGroup(actualLabel)}`,
              ),
            ),
          );
        } catch {}
        setIndex(-1);
        setOpen(true);
      }) as FocusEventHandler<T>,
      onBlur: ((e) => {
        remember(e.currentTarget.value);
        setOpen(false);
        props.onBlur?.(e);
      }) as FocusEventHandler<T>,
      onCompositionStart: () => setComposing(true),
      onCompositionEnd: () => {
        setComposing(false);
        setOpen(true);
        setIndex(-1);
      },
      onInput: () => {
        setOpen(true);
        setIndex(-1);
      },
      onKeyDown: ((e) => {
        if (!composing && open) {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            return;
          }
          if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && values.length) {
            e.preventDefault();
            setIndex(
              (i) =>
                (i +
                  (e.key === 'ArrowDown' ? 1 : values.length - 1) +
                  values.length) %
                values.length,
            );
            return;
          }
          if (e.key === 'Enter' && index >= 0 && values[index]) {
            e.preventDefault();
            choose(values[index]);
            return;
          }
        }
        props.onKeyDown?.(e);
      }) as KeyboardEventHandler<T>,
    },
    popup:
      open && !composing && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={id}
              role="listbox"
              aria-label={`${label}联想提示`}
              data-suggestion-owner={id}
              className="text-suggestions suggestion-surface"
              style={style}
            >
              <small>已有内容 / 历史输入</small>
              {values.length ? (
                values.map((value, i) => (
                  <button
                    key={value}
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={index === i}
                    type="button"
                    tabIndex={-1}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => choose(value)}
                  >
                    {value}
                  </button>
                ))
              ) : (
                <p>暂无匹配内容，可直接输入</p>
              )}
            </div>,
            document.body,
          )
        : null,
  };
}
export const SmartInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { suggestions?: string[] }
>(function SmartInput(props, ref) {
  const s = useSuggestions(props, ref);
  const { suggestions, ...native } = props;
  return (
    <>
      <input {...native} {...s.bind} ref={s.ref} />
      {s.popup}
    </>
  );
});
export const SmartTextarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { suggestions?: string[] }
>(function SmartTextarea(props, ref) {
  const s = useSuggestions(props, ref);
  const { suggestions, ...native } = props;
  return (
    <>
      <textarea {...native} {...s.bind} ref={s.ref} />
      {s.popup}
    </>
  );
});
