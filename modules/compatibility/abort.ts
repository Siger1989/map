/** Missing Web APIs are filled by capability, without changing native implementations. */
export function installAbortCompatibility() {
  if (typeof AbortSignal.timeout !== 'function') {
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      writable: true,
      value(milliseconds: number) {
        if (
          !Number.isSafeInteger(milliseconds) ||
          milliseconds < 0 ||
          milliseconds > 2147483647
        )
          throw new RangeError(
            'Timeout must be between 0 and 2147483647 milliseconds',
          );
        const controller = new AbortController();
        setTimeout(
          () =>
            controller.abort(
              new DOMException('The operation timed out', 'TimeoutError'),
            ),
          milliseconds,
        );
        return controller.signal;
      },
    });
  }
  if (typeof AbortSignal.any !== 'function') {
    Object.defineProperty(AbortSignal, 'any', {
      configurable: true,
      writable: true,
      value(input: Iterable<AbortSignal>) {
        const signals = Array.from(input);
        for (const signal of signals)
          if (!(signal instanceof AbortSignal))
            throw new TypeError('Expected AbortSignal');
        const controller = new AbortController();
        const listeners = new Map<AbortSignal, () => void>();
        const abort = (signal: AbortSignal) => {
          if (!controller.signal.aborted) controller.abort(signal.reason);
          for (const [source, listener] of listeners)
            source.removeEventListener('abort', listener);
          listeners.clear();
        };
        for (const signal of signals) {
          if (signal.aborted) {
            abort(signal);
            break;
          }
          if (listeners.has(signal)) continue;
          const listener = () => abort(signal);
          listeners.set(signal, listener);
          signal.addEventListener('abort', listener, { once: true });
        }
        return controller.signal;
      },
    });
  }
  if (typeof AbortSignal.prototype.throwIfAborted !== 'function') {
    Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', {
      configurable: true,
      writable: true,
      value(this: AbortSignal) {
        if (this.aborted) throw this.reason;
      },
    });
  }
}
