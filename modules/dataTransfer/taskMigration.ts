import type { Recording } from '../outdoor/recording.ts';
import type { TrackDraft } from '../tracks/draft.ts';
import type { TrackStyle } from '../tracks/style.ts';

export const TASK_MIGRATION_FORMAT = 'shantu-paused-task-migration';
export const TASK_MIGRATION_VERSION = 1;
export const TASK_MIGRATION_MAX_BYTES = 8 * 1024 * 1024;

export type MigrationFileReference = { displayName: string; purpose: string };
export type TaskMigrationBackup = {
  format: typeof TASK_MIGRATION_FORMAT;
  version: typeof TASK_MIGRATION_VERSION;
  createdAt: number;
  draft?: Record<string, unknown>;
  recording?: Record<string, unknown>;
  fileReferences: MigrationFileReference[];
};
type MigrationDraft = TrackDraft & {
  id?: string;
  name?: string;
  style?: TrackStyle;
  pointDetails?: Record<string, unknown>;
  edgeNotes?: (string | null)[][];
  routeTerminals?: unknown;
};

/** Export only paused work data. URI grants and unrelated app storage are deliberately excluded. */
export function createTaskMigrationBackup(options: {
  draft?: MigrationDraft;
  recording?: Recording;
  fileReferences?: MigrationFileReference[];
  now?: number;
}): TaskMigrationBackup {
  const createdAt = options.now ?? Date.now();
  if (!Number.isFinite(createdAt)) throw new Error('迁移时间无效');
  const draft = options.draft && options.draft.segments.some(line => line.length)
    ? {
        id: options.draft.id?.trim() || `draft-migration-${createdAt}`,
        name: options.draft.name?.trim() || '画线草稿',
        createdAt,
        source: 'manual',
        segments: clone(options.draft.segments.filter(line => line.length > 0)),
        ...(options.draft.style ? { style: clone(options.draft.style) } : {}),
        ...(options.draft.edgeColors ? { edgeColors: clone(options.draft.edgeColors) } : {}),
        ...(options.draft.colorConditions ? { colorConditions: clone(options.draft.colorConditions) } : {}),
        ...(options.draft.pointDetails ? { pointDetails: clone(options.draft.pointDetails) } : {}),
        ...(options.draft.edgeNotes ? { edgeNotes: clone(options.draft.edgeNotes) } : {}),
        ...(options.draft.routeTerminals ? { routeTerminals: clone(options.draft.routeTerminals) } : {}),
        ...(options.draft.nodes ? { nodes: clone(options.draft.nodes) } : {}),
      }
    : undefined;
  const active = options.recording && ['recording', 'paused'].includes(options.recording.phase) && options.recording.segments.some(line => line.length);
  const recording = active ? {
    id: options.recording!.id,
    phase: 'paused',
    startedAt: options.recording!.startedAt,
    segments: clone(options.recording!.segments),
    ...(options.recording!.style ? { style: clone(options.recording!.style) } : {}),
  } : undefined;
  if (!draft && !recording) throw new Error('当前没有可迁移的画线草稿或暂停记录');
  const fileReferences = (options.fileReferences ?? []).map(({ displayName, purpose }) => {
    const name = displayName.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 240);
    const reason = purpose.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120);
    if (!name || !reason) throw new Error('可重新选择的文件说明不完整');
    return { displayName: name, purpose: reason };
  });
  if (fileReferences.length > 100) throw new Error('可重新选择的文件引用超过100项');
  const result: TaskMigrationBackup = {
    format: TASK_MIGRATION_FORMAT,
    version: TASK_MIGRATION_VERSION,
    createdAt,
    ...(draft ? { draft } : {}),
    ...(recording ? { recording } : {}),
    fileReferences,
  };
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > TASK_MIGRATION_MAX_BYTES) throw new Error('暂停任务迁移文件超过8MiB');
  return result;
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
