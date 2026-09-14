import { validateLayout } from './model.mjs';

export const LAYOUT_ACTION = 'shantu:layout-action';
export const LAYOUT_FILE = 'shantu-layout-draft.json';

/** Export the current draft without changing saved preferences. */
export function downloadLayout(layout, view = window) {
  const content = JSON.stringify(validateLayout(layout), null, 2);
  if (view.GuanyunNative?.saveFile) {
    view.GuanyunNative.saveFile(LAYOUT_FILE, 'application/json', content);
    return '已打开布局文件保存，请选择保存位置';
  }
  const url = view.URL.createObjectURL(
    new view.Blob([content], { type: 'application/json' }),
  );
  const a = view.document.createElement('a');
  a.href = url;
  a.download = LAYOUT_FILE;
  a.dataset.layoutIgnore = '';
  view.document.body.append(a);
  a.click();
  a.remove();
  view.setTimeout(() => view.URL.revokeObjectURL(url), 60000);
  return `已请求下载 ${LAYOUT_FILE}`;
}

/** @returns {Promise<string>} */
export function requestLayoutAction(action, raw = '', view = window) {
  return new Promise((resolve, reject) => {
    const detail = {
      action,
      raw,
      handled: false,
      complete: (error, message) => (error ? reject(error) : resolve(message)),
    };
    view.dispatchEvent(new view.CustomEvent(LAYOUT_ACTION, { detail }));
    if (!detail.handled) reject(Error('布局管理尚未就绪，请稍后重试'));
  });
}

export function bindLayoutActions(view, handlers) {
  const listener = async (event) => {
    const detail = event.detail,
      handler = handlers[detail?.action];
    if (!handler || detail.handled) return;
    detail.handled = true;
    try {
      detail.complete(null, await handler(detail.raw));
    } catch (error) {
      detail.complete(error);
    }
  };
  view.addEventListener(LAYOUT_ACTION, listener);
  return () => view.removeEventListener(LAYOUT_ACTION, listener);
}
