const T9_DIGITS = {
  a: '2', b: '2', c: '2', d: '3', e: '3', f: '3', g: '4', h: '4', i: '4',
  j: '5', k: '5', l: '5', m: '6', n: '6', o: '6', p: '7', q: '7', r: '7', s: '7',
  t: '8', u: '8', v: '8', w: '9', x: '9', y: '9', z: '9',
};

const PLACE_CANDIDATES = [
  ['成都', 'chengdu'], ['春熙路', 'chunxilu'], ['天府广场', 'tianfuguangchang'],
  ['天府机场', 'tianfujichang'], ['怡心湖', 'yixinhu'], ['双流机场', 'shuangliujichang'],
  ['武侯祠', 'wuhouci'], ['财富中心', 'caifuzhongxin'], ['观音桥', 'guanyinqiao'],
  ['北京', 'beijing'], ['上海', 'shanghai'], ['重庆', 'chongqing'], ['绵阳', 'mianyang'],
  ['春熙路南口', 'chunxilunan kou'], ['天府三街', 'tianfusanjie'],
].map(([text, pinyin]) => ({
  text,
  digits: [...pinyin.replaceAll(' ', '').toLowerCase()].map((letter) => T9_DIGITS[letter]).join(''),
}));

const editable = (element) => {
  const view = element?.ownerDocument?.defaultView;
  if (!view || !(element instanceof view.HTMLInputElement || element instanceof view.HTMLTextAreaElement) ||
    element.disabled || element.readOnly || element.type === 'hidden') return false;
  if (element instanceof view.HTMLTextAreaElement) return true;
  return ['text', 'search', 'url', 'tel', 'email', 'password', 'number'].includes(element.type);
};

function setNativeValue(element, value) {
  const win = element.ownerDocument.defaultView;
  const prototype = element instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
}

function selection(element, value) {
  try {
    return {
      start: typeof element.selectionStart === 'number' ? element.selectionStart : value.length,
      end: typeof element.selectionEnd === 'number' ? element.selectionEnd : value.length,
    };
  } catch {
    return { start: value.length, end: value.length };
  }
}

export function installPhonePreviewKeyboard({ phone, frame, width, height }) {
  const panel = document.createElement('section');
  panel.className = 'phone-preview-keyboard';
  panel.setAttribute('aria-label', '九宫格输入法 · 模拟');
  panel.setAttribute('role', 'group');
  panel.hidden = true;

  const heading = document.createElement('div');
  heading.className = 'phone-preview-keyboard-heading';
  heading.innerHTML = '<span>九宫格输入法 · 模拟</span><span>桌面键盘仍可直接输入</span>';
  const candidates = document.createElement('div');
  candidates.className = 'phone-preview-keyboard-candidates';
  candidates.setAttribute('aria-label', '拼音候选');
  const grid = document.createElement('div');
  grid.className = 'phone-preview-keyboard-grid';
  const footer = document.createElement('div');
  footer.className = 'phone-preview-keyboard-footer';
  panel.append(heading, candidates, grid, footer);
  phone.appendChild(panel);

  let target = null;
  let digitBuffer = '';
  let numeric = false;
  let scale = 1;
  let closeTimer = 0;
  let attachedDocument = null;
  let measuredHeight = 0;

  const keyboardHeight = () => Math.min(300, height * 0.48);
  const layout = () => {
    panel.style.width = `${width}px`;
    panel.style.height = `${measuredHeight || keyboardHeight()}px`;
    panel.style.transform = `scale(${scale})`;
    if (panel.hidden) frame.removeAttribute('data-shantu-preview-keyboard');
    else frame.setAttribute('data-shantu-preview-keyboard', 'open');
    frame.style.height = `${panel.hidden ? height : height - (measuredHeight || keyboardHeight())}px`;
  };
  const close = ({ blur = false } = {}) => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = 0;
    const previous = target;
    target = null;
    digitBuffer = '';
    numeric = false;
    footer.querySelector('.phone-preview-keyboard-mode')?.replaceChildren('123');
    panel.hidden = true;
    layout();
    renderCandidates();
    if (blur && previous?.isConnected) previous.blur();
  };
  const appendText = (text) => {
    if (!target || !text) return;
    const oldValue = target.value;
    const { start, end } = selection(target, oldValue);
    const maxLength = target.maxLength > 0 ? target.maxLength : Infinity;
    const inserted = text.slice(0, Math.max(0, maxLength - (oldValue.length - (end - start))));
    const nextValue = oldValue.slice(0, start) + inserted + oldValue.slice(end);
    setNativeValue(target, nextValue);
    try { target.setSelectionRange(start + inserted.length, start + inserted.length); } catch { /* number inputs do not expose text selections */ }
    digitBuffer = '';
    renderCandidates();
  };
  const backspace = () => {
    if (digitBuffer && !numeric) {
      digitBuffer = digitBuffer.slice(0, -1);
      renderCandidates();
      return;
    }
    if (!target) return;
    const value = target.value;
    let { start, end } = selection(target, value);
    if (start === end && start > 0) {
      const current = value.charCodeAt(start - 1);
      const preceding = start > 1 ? value.charCodeAt(start - 2) : 0;
      start -= current >= 0xdc00 && current <= 0xdfff && preceding >= 0xd800 && preceding <= 0xdbff ? 2 : 1;
    }
    if (start === end) return;
    const next = value.slice(0, start) + value.slice(end);
    setNativeValue(target, next);
    try { target.setSelectionRange(start, start); } catch { /* number inputs do not expose text selections */ }
  };
  const matchingCandidates = () => digitBuffer
    ? PLACE_CANDIDATES.filter((candidate) => candidate.digits.startsWith(digitBuffer)).slice(0, 6)
    : PLACE_CANDIDATES.slice(0, 4);
  function renderCandidates() {
    candidates.replaceChildren();
    const state = document.createElement('span');
    state.className = 'phone-preview-keyboard-buffer';
    state.textContent = numeric ? '数字' : digitBuffer || '常用';
    candidates.appendChild(state);
    if (numeric) return;
    const matches = matchingCandidates();
    if (!matches.length && digitBuffer) {
      const hint = document.createElement('span');
      hint.className = 'phone-preview-keyboard-empty';
      hint.textContent = '无模拟候选';
      candidates.appendChild(hint);
    }
    for (const candidate of matches) {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.textContent = candidate.text;
      button.addEventListener('click', () => appendText(candidate.text));
      candidates.appendChild(button);
    }
  }
  const makeKey = (digit, letters) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'phone-preview-key';
    button.tabIndex = -1;
    button.innerHTML = `<strong>${digit}</strong><small>${letters}</small>`;
    button.addEventListener('click', () => {
      if (digit === '#') close({ blur: true });
      else if (numeric) appendText(digit === '*' ? '*' : digit);
      else if (digit === '*') appendText('。');
      else if (digit === '0') appendText(' ');
      else if (digit === '1') appendText('，');
      else { digitBuffer += digit; renderCandidates(); }
    });
    return button;
  };
  for (const [digit, letters] of [
    ['1', '，。'], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'],
    ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', '符号'],
    ['0', '空格'], ['#', '完成'],
  ]) {
    grid.appendChild(makeKey(digit, letters));
  }

  const action = (label, className, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.tabIndex = -1;
    button.textContent = label;
    button.addEventListener('click', handler);
    footer.appendChild(button);
  };
  action('123', 'phone-preview-keyboard-mode', () => {
    numeric = !numeric;
    digitBuffer = '';
    panel.classList.toggle('is-numeric', numeric);
    footer.querySelector('.phone-preview-keyboard-mode').textContent = numeric ? '中文' : '123';
    renderCandidates();
  });
  action('，', 'phone-preview-keyboard-action', () => appendText('，'));
  action('空格', 'phone-preview-keyboard-space', () => appendText(' '));
  action('⌫', 'phone-preview-keyboard-action', backspace);
  action('完成', 'phone-preview-keyboard-done', () => close({ blur: true }));

  panel.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  }, true);
  panel.addEventListener('click', (event) => event.stopPropagation());

  const openFor = (element) => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = 0;
    if (target !== element) digitBuffer = '';
    target = element;
    measuredHeight = keyboardHeight();
    panel.hidden = false;
    panel.classList.remove('is-numeric');
    numeric = false;
    layout();
    renderCandidates();
  };
  const bindFrameDocument = () => {
    close();
    let doc;
    try { doc = frame.contentDocument; } catch { return; }
    if (!doc || doc === attachedDocument) return;
    attachedDocument = doc;
    doc.addEventListener('focusin', (event) => {
      if (editable(event.target)) openFor(event.target);
    }, true);
    doc.addEventListener('focusout', (event) => {
      if (event.target !== target) return;
      if (event.relatedTarget?.closest?.('.floating-search, [data-search-owner], [data-place-result]')) {
        closeTimer = setTimeout(() => close(), 450);
        return;
      }
      closeTimer = setTimeout(() => {
        if (!editable(doc.activeElement)) close();
      }, 180);
    }, true);
    doc.addEventListener('input', (event) => {
      if (event.target === target && !numeric) {
        digitBuffer = '';
        renderCandidates();
      }
    }, true);
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !target) return;
      event.preventDefault();
      event.stopPropagation();
      close({ blur: true });
    }, true);
    doc.addEventListener('click', (event) => {
      if (event.target?.closest?.('.floating-search, [data-search-owner], [data-place-result]')) {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          if (!editable(doc.activeElement)) close();
        }, 350);
      }
    }, true);
  };
  frame.addEventListener('load', bindFrameDocument);
  bindFrameDocument();
  renderCandidates();

  return {
    setScale(value) {
      scale = Number.isFinite(value) && value > 0 ? value : 1;
      layout();
    },
    close,
  };
}
