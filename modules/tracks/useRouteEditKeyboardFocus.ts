import { useEffect, type RefObject } from 'react';

type KeyboardWindow = Window & {
  visualViewport?: VisualViewport | null;
  navigator: Navigator & {
    virtualKeyboard?: EventTarget & { boundingRect?: DOMRectReadOnly };
  };
};

export function routeEditKeyboardOcclusion(
  layoutHeight: number,
  visibleHeight: number,
  offsetTop = 0,
  keyboardTop?: number,
) {
  const visibleBottom = Math.min(
    offsetTop + visibleHeight,
    keyboardTop !== undefined && Number.isFinite(keyboardTop) ? keyboardTop : Infinity,
  );
  return Math.max(0, layoutHeight - visibleBottom);
}

/** Lift only the route editor while its name field's on-screen keyboard is visible. */
export function useRouteEditKeyboardFocus(dockRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const root = document.documentElement;
    const keyboardWindow = window as KeyboardWindow;
    let focused = false;
    let blurredWithKeyboard = false;
    let baselineHeight = 0;
    let frame = 0;

    const cssPixels = (name: string) => {
      const value = Number.parseFloat(getComputedStyle(root).getPropertyValue(name));
      return Number.isFinite(value) && value > 0 ? value : 0;
    };
    const reveal = () => {
      frame = 0;
      const visual = keyboardWindow.visualViewport;
      const nativeKeyboard = keyboardWindow.navigator.virtualKeyboard;
      const keyboardRect = nativeKeyboard?.boundingRect;
      const layoutHeight = Math.max(
        cssPixels('--shantu-layout-height'),
        window.innerHeight,
        document.documentElement.clientHeight,
      );
      const visualHeight = cssPixels('--shantu-visual-height') || visual?.height || window.innerHeight;
      const offsetTop = visual?.offsetTop ?? 0;
      const inset = routeEditKeyboardOcclusion(
        layoutHeight,
        visualHeight,
        offsetTop,
        keyboardRect && keyboardRect.height > 0 ? keyboardRect.top : undefined,
      );
      // A resized WebView already moves a fixed-bottom dock above the keyboard.
      // Only add the remaining overlay inset; the pre-focus height detects the
      // keyboard but must not add a second 300px lift in the phone preview.
      const keyboardVisible = inset > 60 || baselineHeight - layoutHeight > 60;
      const keepLifted = keyboardVisible && (focused || blurredWithKeyboard);

      if (keepLifted) {
        dock.dataset.nameKeyboard = 'open';
        dock.style.setProperty('--route-edit-ime-inset', `${Math.ceil(inset)}px`);
      } else {
        delete dock.dataset.nameKeyboard;
        dock.style.removeProperty('--route-edit-ime-inset');
        if (!focused) {
          blurredWithKeyboard = false;
          baselineHeight = 0;
        }
      }
    };
    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };
    const isRouteName = (target: EventTarget | null) =>
      target instanceof HTMLInputElement && target.matches('.route-edit-name-input');
    const onFocusIn = (event: FocusEvent) => {
      if (!isRouteName(event.target)) return;
      focused = true;
      blurredWithKeyboard = false;
      baselineHeight = Math.max(window.innerHeight, document.documentElement.clientHeight);
      schedule();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!isRouteName(event.target)) return;
      focused = false;
      blurredWithKeyboard = true;
      schedule();
    };
    const nativeKeyboard = keyboardWindow.navigator.virtualKeyboard;

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    keyboardWindow.visualViewport?.addEventListener('resize', schedule);
    keyboardWindow.visualViewport?.addEventListener('scroll', schedule);
    nativeKeyboard?.addEventListener('geometrychange', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      keyboardWindow.visualViewport?.removeEventListener('resize', schedule);
      keyboardWindow.visualViewport?.removeEventListener('scroll', schedule);
      nativeKeyboard?.removeEventListener('geometrychange', schedule);
      delete dock.dataset.nameKeyboard;
      dock.style.removeProperty('--route-edit-ime-inset');
    };
  }, [dockRef]);
}
