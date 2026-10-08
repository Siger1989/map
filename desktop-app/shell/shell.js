(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const frames = [...document.querySelectorAll('.workspace')];
  const fullscreenButton = document.getElementById('fullscreen-toggle');
  const helpButton = document.getElementById('help-toggle');
  const help = document.getElementById('mouse-help');
  const message = document.getElementById('desktop-message');
  let toggling = false;
  function setHelp(open) {
    help.hidden = !open;
    helpButton.setAttribute('aria-expanded', String(open));
  }
  function selectWorkspace(name) {
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
          // The selection surface owns map gestures. Keep the existing desktop controls clickable above it.
          const style = doc.createElement('style');
          style.dataset.desktopMapControls = 'true';
          style.textContent = `.observatory.home-map:has(.map-box-selection[data-active='true']) .home-position-dock:not(:has(.route-display-settings)),
            .observatory.home-map:has(.map-box-selection[data-active='true']) .home-camera-control { z-index: 25; }`;
          doc.head.append(style);
        }
      } catch { /* Only same-origin documents can attach desktop shortcuts. */ }
    });
  }
  helpButton.addEventListener('click', () => setHelp(help.hidden));
  document.getElementById('help-close').addEventListener('click', () => { setHelp(false); helpButton.focus(); });
  fullscreenButton.addEventListener('click', () => void toggleFullscreen());
  document.addEventListener('keydown', handleKey, true);
  document.addEventListener('fullscreenchange', () => renderFullscreen(Boolean(document.fullscreenElement)));
  window.addEventListener('pywebviewready', async () => {
    try { renderFullscreen((await window.pywebview.api.get_window_state()).fullscreen); } catch { /* Initial window state is optional. */ }
  });
})();
