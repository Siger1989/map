import { positionFix, type PositionFix, type LocationMode } from './types.ts';

export type NativePositionBridge = {
  locate(mode: string): void;
  locationState(): string;
  stopLocation(): void;
};

export function readNativePosition(raw: string, now = Date.now()) {
  const state = JSON.parse(raw);
  let fix: PositionFix | null = null;
  if (state?.fix && ['gps', 'network'].includes(state.fix.source)) {
    const value = positionFix({
      coords: state.fix,
      timestamp: state.fix.timestamp,
    } as GeolocationPosition);
    if (
      value &&
      value.timestamp <= now + 5000 &&
      now - value.timestamp <= 30000
    )
      fix = { ...value, source: state.fix.source };
  }
  return {
    fix,
    error:
      typeof state?.error === 'string' && state.error
        ? state.error
        : state?.fix && !fix
          ? '位置已过期，正在等待新的定位结果'
          : '',
  };
}

/** The activity owns permission/lifecycle; the hook owns this foreground subscription. */
export function watchNativePosition(
  bridge: NativePositionBridge,
  mode: LocationMode,
  onFix: (fix: PositionFix) => void,
  onError: (error: string) => void,
) {
  let previous = '',
    previousError = '',
    stopped = false;
  bridge.locate(mode);
  const update = () => {
    if (stopped) return;
    try {
      const raw = bridge.locationState();
      // The UI command is asynchronous; ignore the previous mode's snapshot.
      const state = JSON.parse(raw);
      if (state.mode !== mode) return;
      const result = readNativePosition(raw);
      if (result.fix && raw !== previous) {
        onFix(result.fix);
        previous = raw;
      }
      if (result.error !== previousError) {
        onError(result.error);
        previousError = result.error;
      }
    } catch {
      if (previousError !== '定位读取失败，请重新定位') {
        previousError = '定位读取失败，请重新定位';
        onError(previousError);
      }
    }
  };
  const timer = setInterval(update, 1000);
  return () => {
    stopped = true;
    clearInterval(timer);
    bridge.stopLocation();
  };
}
