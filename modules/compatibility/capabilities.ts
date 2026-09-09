export type RuntimeCapabilities = {
  webgl2: boolean;
  worker: boolean;
  wasm: boolean;
  userAgent: string;
};

/** Probe a disposable canvas; never infer graphics support from an OEM version. */
export function probeRuntime(
  document: Document,
  runtime: Window & typeof globalThis,
): RuntimeCapabilities {
  let webgl2 = false;
  try {
    const context = document.createElement('canvas').getContext('webgl2');
    webgl2 = Boolean(context && !context.isContextLost());
    context?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* A driver can reject context creation even if the API exists. */
  }
  return {
    webgl2,
    worker: typeof runtime.Worker === 'function',
    wasm: typeof runtime.WebAssembly === 'object',
    userAgent: runtime.navigator.userAgent,
  };
}
