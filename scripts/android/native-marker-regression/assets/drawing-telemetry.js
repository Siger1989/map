(() => {
  const key = '__shantuNative160DrawingTelemetry';
  const TYPES = new Set(['start', 'move', 'end', 'cancel']);
  let state = null;

  const percentile = (values, fraction) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  };
  const snapshot = (active = !!state) => {
    if (!state) return JSON.stringify({ active: false, inputEvents: 0, svgPointerEvents: 0, svgAttributeMutations: 0, latencySamples: 0, captureReplies: 0, captureSamples: 0, magnifierDrawImage: 0, firstCaptureReplyMs: null });
    const latencies = state.latencies;
    const lastCapture = state.captures.length ? state.captures[state.captures.length - 1] : null;
    return JSON.stringify({
      active,
      durationMs: Math.max(0, performance.now() - state.startedAt),
      inputEvents: state.inputEvents,
      svgPointerEvents: state.svgPointerEvents,
      svgAttributeMutations: state.svgAttributeMutations,
      latencySamples: latencies.length,
      latencyP50Ms: percentile(latencies, 0.5),
      latencyP95Ms: percentile(latencies, 0.95),
      latencyMaxMs: latencies.length ? Math.max(...latencies) : null,
      captureReplies: state.captureReplies,
      captureSamples: state.captures.length,
      captureWidth: lastCapture?.width ?? null,
      captureHeight: lastCapture?.height ?? null,
      captureMimeType: lastCapture?.mimeType ?? null,
      captureCropWidthCss: lastCapture?.cropWidthCss ?? null,
      captureCropHeightCss: lastCapture?.cropHeightCss ?? null,
      captureDurationMs: lastCapture?.captureDurationMs ?? null,
      captureDataUrlLength: lastCapture?.dataUrlLength ?? null,
      magnifierDrawImage: state.magnifierDrawImage,
      firstCaptureReplyMs: state.firstCaptureReplyMs,
      lastFrameSnapRevision: state.lastFrameSnapRevision,
      snapResponses: state.snapResponses.slice(),
    });
  };
  const stop = () => {
    const current = state;
    if (!current) return snapshot(false);
    current.documentObserver?.disconnect();
    current.svgObserver?.disconnect();
    document.removeEventListener('pointerdown', current.onPointer, true);
    document.removeEventListener('pointermove', current.onPointer, true);
    document.removeEventListener('pointerup', current.onPointer, true);
    document.removeEventListener('pointercancel', current.onPointer, true);
    window.removeEventListener('shantu:native-map', current.onBridge);
    if (current.canvasPrototype && current.wrapper && current.canvasPrototype.drawImage === current.wrapper)
      current.canvasPrototype.drawImage = current.originalDrawImage;
    const result = snapshot(false);
    state = null;
    return result;
  };
  const start = () => {
    if (state) return snapshot(true);
    const canvasPrototype = window.CanvasRenderingContext2D?.prototype;
    const originalDrawImage = canvasPrototype?.drawImage;
    const current = {
      startedAt: performance.now(),
      inputEvents: 0,
      svgPointerEvents: 0,
      svgAttributeMutations: 0,
      captureReplies: 0,
      firstCaptureReplyMs: null,
      magnifierDrawImage: 0,
      lastInputAt: null,
      latencies: [],
      captures: [],
      lastFrameSnapRevision: null,
      snapResponses: [],
      svg: null,
      svgObserver: null,
      documentObserver: null,
      canvasPrototype,
      originalDrawImage,
      wrapper: null,
      onPointer: null,
      onBridge: null,
    };
    const observeSvg = () => {
      const found = document.querySelector('.track-drawing');
      if (found === current.svg) return;
      current.svgObserver?.disconnect();
      current.svgObserver = null;
      current.svg = found;
      if (!found || typeof MutationObserver !== 'function') return;
      current.svgObserver = new MutationObserver((records) => {
        current.svgAttributeMutations += records.length;
        if (current.lastInputAt !== null && current.latencies.length < 100)
          current.latencies.push(Math.max(0, performance.now() - current.lastInputAt));
      });
      current.svgObserver.observe(found, { attributes: true, subtree: true });
    };
    current.onPointer = (event) => {
      if (!event.target?.closest?.('.track-drawing')) return;
      current.svgPointerEvents++;
      current.lastInputAt = performance.now();
    };
    current.onBridge = (event) => {
      const message = event.detail;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'event' && ['renderFrame', 'cameraFrame'].includes(message.payload?.name)) {
        const revision = message.payload.value?.snapRevision;
        if (Number.isSafeInteger(revision)) current.lastFrameSnapRevision = revision;
      }
      if (message.type === 'event' && message.payload?.name === 'snapGeometry') {
        const value = message.payload.value;
        if (value && Number.isSafeInteger(value.cameraRevision)) {
          if (current.snapResponses.length === 100) current.snapResponses.shift();
          current.snapResponses.push({ revision: value.cameraRevision, frameRevision: current.lastFrameSnapRevision,
            roadStatus: String(value.road?.status), roadLineCount: value.road?.lines?.length ?? 0,
            riverStatus: String(value.river?.status), atMs: performance.now() - current.startedAt });
        }
      }
      if (message.type === 'event' && message.payload?.name === 'drawingInput') {
        const input = message.payload.value;
        if (!input || !TYPES.has(input.type)) return;
        current.inputEvents++;
        current.lastInputAt = performance.now();
        return;
      }
      if (message.type !== 'result') return;
      const payload = message.payload;
      if (!payload || typeof payload !== 'object' || typeof payload.dataUrl !== 'string' || !payload.dataUrl.startsWith('data:image/')) return;
      current.captureReplies++;
      const dataUrlLength = payload.dataUrl.length;
      // Response timing only; this does not verify that returned pixels contain map texture.
      if (dataUrlLength > 0 && current.firstCaptureReplyMs === null)
        current.firstCaptureReplyMs = Math.max(0, performance.now() - current.startedAt);
      const crop = payload.cropCssRect;
      const sample = {
        width: Number.isFinite(payload.width) ? payload.width : null,
        height: Number.isFinite(payload.height) ? payload.height : null,
        mimeType: typeof payload.mimeType === 'string' ? payload.mimeType : payload.dataUrl.slice(5, payload.dataUrl.indexOf(';')),
        cropWidthCss: Number.isFinite(crop?.width) ? crop.width : null,
        cropHeightCss: Number.isFinite(crop?.height) ? crop.height : null,
        captureDurationMs: Number.isFinite(payload.captureDurationMs) ? payload.captureDurationMs : null,
        dataUrlLength,
      };
      if (current.captures.length === 100) current.captures.shift();
      current.captures.push(sample);
    };
    document.addEventListener('pointerdown', current.onPointer, true);
    document.addEventListener('pointermove', current.onPointer, true);
    document.addEventListener('pointerup', current.onPointer, true);
    document.addEventListener('pointercancel', current.onPointer, true);
    window.addEventListener('shantu:native-map', current.onBridge);
    if (canvasPrototype && typeof originalDrawImage === 'function') {
      current.wrapper = function (...args) {
        if (this.canvas?.closest?.('.point-magnifier')) current.magnifierDrawImage++;
        return originalDrawImage.apply(this, args);
      };
      canvasPrototype.drawImage = current.wrapper;
    }
    current.documentObserver = typeof MutationObserver === 'function' ? new MutationObserver(observeSvg) : null;
    if (document.documentElement) current.documentObserver?.observe(document.documentElement, { childList: true, subtree: true });
    observeSvg();
    state = current;
    return snapshot(true);
  };
  const api = { start, stop, snapshot: () => snapshot(true) };
  Object.defineProperty(window, key, { value: api, configurable: true, writable: false });
})();
