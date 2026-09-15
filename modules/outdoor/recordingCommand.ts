import { readRecording, type Recording } from './recording.ts';
export type RecordingAction = 'start' | 'pause' | 'resume' | 'finish' | 'clear';
/** Await the native acknowledgement, never save a React snapshot from before finish. */
export async function awaitRecordingCommand(
  action: RecordingAction,
  expectedId: string,
  bridge: {
    record: (action: string) => void;
    recordState: () => string;
    recordFor?: (action: string, id: string) => string;
  },
  options: { wait?: () => Promise<void>; attempts?: number } = {},
): Promise<Recording> {
  const before = readRecording(bridge.recordState());
  if (before.id !== expectedId)
    throw new Error('记录已切换，请重新打开本次行程');
  if (bridge.recordFor && (action === 'finish' || action === 'clear')) {
    const reply = JSON.parse(bridge.recordFor(action, expectedId));
    if (!reply.ok) throw new Error(reply.error || '记录操作失败，原记录保留');
    const record = readRecording(reply.record);
    if (
      action === 'finish' &&
      (record.id !== expectedId || record.phase !== 'finished')
    )
      throw new Error('记录结束未确认');
    if (action === 'clear' && record.phase !== 'idle')
      throw new Error('记录清理未确认');
    return record;
  }
  bridge.record(action);
  const phase = {
    start: 'recording',
    resume: 'recording',
    pause: 'paused',
    finish: 'finished',
    clear: 'idle',
  }[action];
  const wait =
    options.wait ?? (() => new Promise((resolve) => setTimeout(resolve, 120)));
  for (let attempt = 0; attempt < (options.attempts ?? 75); attempt++) {
    await wait();
    const record = readRecording(bridge.recordState());
    if (
      record.phase === phase &&
      (action === 'clear'
        ? !record.id
        : action === 'start'
          ? !!record.id
          : record.id === expectedId)
    )
      return record;
    if (record.id !== expectedId) throw new Error('记录已切换，已停止本次操作');
  }
  throw new Error('未收到记录操作确认，当前记录保留，请重试');
}
