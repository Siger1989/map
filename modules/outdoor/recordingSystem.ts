export const OPEN_RECORDING_EVENT = 'shantu:open-recording';
export const RECORDING_SYSTEM_STATE_EVENT = 'shantu:recording-system-state';

type RecordingSetting = 'permissions' | 'location' | 'notifications' | 'battery' | 'powerSaver';

export type RecordingSystemState = {
  preciseLocation: boolean;
  systemLocation: boolean;
  notifications: boolean;
  batteryUnrestricted: boolean;
  batterySaver: boolean;
  backgroundRestricted: boolean;
};

declare global {
  interface Window {
    ShantuRecordingSystem?: {
      state(): string;
      takeOpenRecording(): boolean;
      openSettings(setting: RecordingSetting): void;
      addTile(): void;
    };
  }
}

export function recordingSystem() {
  return typeof window !== 'undefined' ? window.ShantuRecordingSystem : undefined;
}

export function readRecordingSystem(): RecordingSystemState | null {
  try {
    const raw = recordingSystem()?.state();
    if (!raw) return null;
    const state = JSON.parse(raw);
    return state && typeof state.preciseLocation === 'boolean' && typeof state.systemLocation === 'boolean' &&
      typeof state.notifications === 'boolean' && typeof state.batteryUnrestricted === 'boolean' &&
      typeof state.batterySaver === 'boolean' && typeof state.backgroundRestricted === 'boolean' ? state : null;
  } catch {
    return null;
  }
}
