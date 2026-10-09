(() => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const frames = [...document.querySelectorAll('.workspace')];
  const fullscreenButton = document.getElementById('fullscreen-toggle');
  const helpButton = document.getElementById('help-toggle');
  const help = document.getElementById('mouse-help');
  const message = document.getElementById('desktop-message');
  const panOverlay = document.getElementById('map-pan-overlay');
  const panButton = document.getElementById('map-pan');
  const panThumb = document.getElementById('pan-thumb');
  let panPointer = null;
  let panFrame = 0;
  let panVector = { x: 0, y: 0 };
  let panTime = 0;
  let panActive = false;
  function dispatchPan(detail) {
    const frame = document.getElementById('map-frame');
    try {
      if (!frame?.contentWindow) return false;
      frame.contentWindow.dispatchEvent(new frame.contentWindow.CustomEvent('shantu-desktop-pan', { detail }));
      return true;
    } catch { return false; /* The map frame may be unloading. */ }
  }
  function stopPan() {
    cancelAnimationFrame(panFrame);
    panFrame = 0;
    panTime = 0;
    const pointer = panPointer;
    panPointer = null;
    if (panActive) {
      dispatchPan({ phase: 'end', handled: false });
      panActive = false;
    }
    if (pointer !== null && panButton.hasPointerCapture(pointer)) panButton.releasePointerCapture(pointer);
    panThumb.style.transform = '';
  }
  function updatePan(event) {
    const rect = panButton.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    const length = Math.hypot(x, y);
    const scale = length > 20 ? 20 / length : 1;
    panVector = { x: x * scale, y: y * scale };
    panThumb.style.transform = `translate(${panVector.x}px, ${panVector.y}px)`;
  }
  function panTick(time) {
    if (panPointer === null || panButton.disabled) return stopPan();
    const elapsed = panTime ? Math.min(time - panTime, 50) : 16;
    panTime = time;
    if (Math.hypot(panVector.x, panVector.y) > 2) {
      if (!dispatchPan({ phase: 'move', dx: panVector.x * elapsed / 40, dy: panVector.y * elapsed / 40, handled: false })) return stopPan();
      panActive = true;
    } else if (panActive) {
      dispatchPan({ phase: 'end', handled: false });
      panActive = false;
    }
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
    panOverlay.hidden = name !== 'map';
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
          style.textContent = `html[data-shantu-desktop='true'] .observatory.home-map :is(.home-camera-control, .map-comparison-ui .map-comparison-gizmo) {
              position: absolute !important; top: auto !important; right: auto !important; bottom: calc(var(--home-footer) + 45px) !important; left: min(50%, calc(100% - 228px)) !important;
              width: 110px !important; height: 118px !important; margin: 0 !important; transform: translateX(-50%) !important; z-index: 25 !important;
            }
            html[data-shantu-desktop='true'] .observatory.home-map :is(.home-camera-control .camera-gizmo, .map-comparison-ui .map-comparison-gizmo .camera-gizmo) {
              position: relative !important; inset: auto !important; top: auto !important; right: auto !important; bottom: auto !important; left: auto !important;
              width: 110px !important; height: 118px !important; margin: 0 !important; transform: none !important;
            }
            html[data-shantu-desktop='true'] .observatory.home-map :is(.home-camera-control .camera-gizmo > svg, .map-comparison-ui .map-comparison-gizmo .camera-gizmo > svg) {
              display: block !important; width: 110px !important; height: 118px !important;
            }
            @media (max-width: 740px) {
              html[data-shantu-desktop='true'] .observatory.home-map[data-survey='true'] .survey-dock {
                bottom: calc(var(--home-footer) + 176px) !important;
                max-height: calc(100dvh - var(--home-top) - var(--home-header-height) - var(--home-footer) - 184px) !important;
              }
              html[data-shantu-desktop='true'] .observatory.home-map[data-survey='true'] .survey-dock .survey-dock-content {
                flex: 1 1 auto !important; min-height: 0; overflow: auto !important;
              }
              html[data-shantu-desktop='true'] .observatory.home-map[data-survey='true'] .survey-dock .survey-action-row {
                flex-shrink: 0;
              }
              html[data-shantu-desktop='true'] .observatory.home-map :is(.track-tools, .track-draw-tools) {
                bottom: calc(var(--home-footer) + 176px) !important;
                max-height: calc(100dvh - var(--home-top) - var(--home-header-height) - var(--home-footer) - 184px) !important;
                overflow: auto !important;
              }
            }
            @media (max-width: 740px) and (max-height: 600px) {
              html[data-shantu-desktop='true'] .observatory.home-map :is(.home-camera-control, .map-comparison-ui .map-comparison-gizmo) {
                left: min(50%, calc(100% - 272px)) !important;
              }
            }
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
