export const DEFAULT_RECORDING_ACCURACY = 20;
export const LEGACY_RECORDING_ACCURACY = 80;
export const RECORDING_ACCURACY_KEY = 'guanyun.recording.max-accuracy.v1';
export function validRecordingAccuracy(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 5 &&
    value <= 80
  );
}
export function readRecordingAccuracy(value: unknown) {
  return validRecordingAccuracy(value) ? value : DEFAULT_RECORDING_ACCURACY;
}
export function recordingAccuracyMessage(accuracy: number, maximum: number) {
  return Number.isFinite(accuracy) && accuracy > maximum
    ? `当前估计误差 ${Math.ceil(accuracy)} 米，超过设置的 ${maximum} 米；该点未记录，等待更好信号`
    : '';
}
