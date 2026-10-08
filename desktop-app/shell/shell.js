(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const frames = [...document.querySelectorAll('.workspace')];
  const fullscreenButton = document.getElementById('fullscreen-toggle');
  const helpButton = document.getElementById('help-toggle');
  const help = document.getElementById('mouse-help');
  const message = document.getElementById('desktop-message');
  const panButton = document.getElementById('map-pan');
  const panThumb = document.getElementById('pan-thumb');
  let panPointer = null;
  let panFrame = 0;
  let panVector = { x: 0, y: 0 };
  let panTime = 0;
  function stopPan() {
    cancelAnimationFrame(panFrame);
    panFrame = 0;
    panTime = 0;
    const pointer = panPointer;
    panPointer = null;
    if (pointer !== null && panButton.hasPointerCapture(pointer)) panButton.releasePointerCapture(pointer);
    panThumb.style.transform = '';
  }
  function updatePan(event) {
    const rect = panButton.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const length = Math.hypot(x, y);
    const scale = length > 16 ? 16 / length : 1;
    panVector = { x: x * scale, y: y * scale };
    panThumb.style.transform = `translate(${panVector.x}px, ${panVector.y}px)`;
  }
  function panTick(time) {
    if (panPointer === null || panButton.disabled) return stopPan();
    const elapsed = panTime ? Math.min(time - panTime, 50) : 16;
    panTime = time;
    const frame = document.getElementById('map-frame');
    const detail = { dx: panVector.x * elapsed / 20, dy: panVector.y * elapsed / 20, handled: false };
    try {
      if (Math.hypot(panVector.x, panVector.y) > 2) {
        frame.contentWindow.dispatchEvent(new frame.contentWindow.CustomEvent('shantu-desktop-pan', { detail }));
      }
    } catch { return stopPan(); }
    panFrame = requestAnimationFrame(panTick);
  }
  let toggling = false;
  function setHelp(open) {
    help.hidden = !open;
    helpButton.setAttribute('aria-expanded', String(open));
  }
  function selectWorkspace(name) {
    stopPan();
    panButton.disabled = name !== 'map';
    if (name === 'industry' && !document.getElementById('industry-frame').getAttribute('src')) {
      document.getElementById('industry-frame').src = '/industry/';
    }
    for (const tab of tabs) {
      const selected = tab.dataset.workspace === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const frame of frames) {
      const inactive = frame.id !== `${name}-frame`;
      frame.classList.toggle('is-inactive', inactive);
      frame.inert = inactive;
      frame.setAttribute('aria-hidden', String(inactive));
    }
    setHelp(false);
  }
  function renderFullscreen(fullscreen) {
    fullscreenButton.textContent = fullscreen ? '退出全屏 · F11' : '全屏 · F11';
    fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
  }
  async function toggleFullscreen() {
    if (toggling) return;
    toggling = true;
    message.hidden = true;
    try {
      if (window.pywebview?.api?.toggle_fullscreen) {
        const state = await window.pywebview.api.toggle_fullscreen();
        renderFullscreen(state.fullscreen);
      } else if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      message.textContent = '无法切换全屏，请使用桌面窗口顶部的最大化按钮。';
      message.hidden = false;
    } finally { toggling = false; }
  }
  function handleKey(event) {
    if (event.key === 'F11') {
      event.preventDefault();
      event.stopPropagation();
      void toggleFullscreen();
    }
  }
  for (const tab of tabs) {
    tab.addEventListener('click', () => selectWorkspace(tab.dataset.workspace));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectWorkspace(tabs[next].dataset.workspace);
      tabs[next].focus();
    });
  }
  for (const frame of frames) {
    frame.addEventListener('load', () => {
      try {
        const doc = frame.contentDocument;
        doc.addEventListener('keydown', handleKey, true);
        if (frame.id === 'map-frame') {
          doc.documentElement.dataset.shantuDesktop = 'true';
          // The selection surface owns map gestures. Keep the existing desktop controls clickable above it.
          const style = doc.createElement('style');
          style.dataset.desktopMapControls = 'true';
          style.textContent = `html[data-shantu-desktop='true'] .observatory.home-map :is(.home-camera-control, .map-comparison-ui .map-comparison-gizmo) { left: 50%; right: auto; transform: translateX(-50%); }
            .observatory.home-map:has(.map-box-selection[data-active='true']) .home-position-dock:not(:has(.route-display-settings)),
            .observatory.home-map:has(.map-box-selection[data-active='true']) .home-camera-control { z-index: 25; }`;
          doc.head.append(style);
        }
      } catch { /* Only same-origin documents can attach desktop shortcuts. */ }
    });
  }
  helpButton.addEventListener('click', () => setHelp(help.hidden));
  panButton.addEventListener('pointerdown', event => {
    if (event.button !== 0 || panButton.disabled || panPointer !== null) return;
    event.preventDefault();
    panPointer = event.pointerId;
    panButton.setPointerCapture(event.pointerId);
    updatePan(event);
    panFrame = requestAnimationFrame(panTick);
  });
  panButton.addEventListener('pointermove', event => { if (event.pointerId === panPointer) updatePan(event); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) panButton.addEventListener(type, stopPan);
  window.addEventListener('blur', stopPan);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPan(); });
  document.getElementById('help-close').addEventListener('click', () => { setHelp(false); helpButton.focus(); });
  fullscreenButton.addEventListener('click', () => void toggleFullscreen());
  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('fullscreenchange', () => renderFullscreen(Boolean(document.fullscreenElement)));
  window.addEventListener('pywebviewready', async () => {
    try { renderFullscreen((await window.pywebview.api.get_window_state()).fullscreen); } catch { /* Initial window state is optional. */ }
  });
})();
