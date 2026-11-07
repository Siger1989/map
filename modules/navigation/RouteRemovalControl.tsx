import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import './routeRemovalControl.css';

type RouteRemovalControlProps = {
  onRemove: () => boolean | void | Promise<boolean | void>;
  className?: string;
  buttonClassName?: string;
  label?: string;
};

const confirmation = '删除当前规划路线？已保存的收藏、轨迹和标记保留。';

/** Compact delete affordance with an in-card confirmation that never changes card height. */
export function RouteRemovalControl({ onRemove, className = '', buttonClassName = '', label = '删除' }: RouteRemovalControlProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      if (busy) dialogRef.current?.focus();
      else cancelRef.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef.current?.focus();
    }
  }, [open, busy]);

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!busyRef.current) setOpen(false);
      return;
    }
    if (event.key !== 'Tab') return;
    const first = cancelRef.current;
    const last = confirmRef.current;
    if (!first || !last || busyRef.current) {
      event.preventDefault();
      dialogRef.current?.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const confirm = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const result = onRemove();
      const pending = result as Promise<boolean | void> | undefined;
      if (pending && typeof pending.then === 'function') {
        void pending.then(
          (removed) => {
            if (removed === false) setError('路线显示状态未保存，删除没有完成。');
            else setOpen(false);
          },
          () => setError('删除未完成，请重试。'),
        ).finally(() => {
          busyRef.current = false;
          setBusy(false);
        });
      } else {
        if (result === false) setError('路线显示状态未保存，删除没有完成。');
        else setOpen(false);
        busyRef.current = false;
        setBusy(false);
      }
    } catch {
      busyRef.current = false;
      setBusy(false);
      setError('删除未完成，请重试。');
    }
  };

  return <div className={`route-removal-control ${className}`.trim()}>
    <button ref={triggerRef} type="button" className={`route-removal-trigger ${buttonClassName}`.trim()} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => { setError(''); setOpen(true); }}>{label}</button>
    {open && <div ref={dialogRef} className="route-removal-confirm" role="alertdialog" aria-modal="true" aria-label="确认删除当前规划路线" aria-busy={busy} tabIndex={-1} onKeyDown={handleDialogKeyDown}>
      <p>{confirmation}</p>
      {error && <p className="route-removal-error" role="alert">{error}</p>}
      <div className="route-removal-confirm-actions">
        <button ref={cancelRef} type="button" disabled={busy} onClick={() => setOpen(false)}>取消</button>
        <button ref={confirmRef} type="button" className="route-removal-danger" aria-label="确认删除当前规划路线" disabled={busy} onClick={confirm}>{busy ? '处理中…' : '确认删除'}</button>
      </div>
    </div>}
  </div>;
}
