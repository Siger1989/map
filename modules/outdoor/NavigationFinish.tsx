import { useState } from 'react';
import type { Recording } from './recording';
import type { useRecording } from './useRecording';
import type { GuidanceSession } from '../guidance/session';
import { saveRecording, recordingTrack } from './savedRecording';
import { trackDistance } from '../tracks/drawing';
import { formatDistance } from '../navigation/types';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
import './recordingWindow.css';
export function NavigationFinish({
  session,
  recorder,
  onBack,
  onStop,
  onSaved,
}: {
  session: GuidanceSession;
  recorder: ReturnType<typeof useRecording>;
  onBack: () => void;
  onStop: (keepRecord: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const [expectedId] = useState(
    recorder.record.phase === 'idle' ? '' : recorder.record.id,
  );
  const [error, setError] = useState(''),
    [working, setWorking] = useState(false);
  const root = useRouteDialogFocus(() => {
    if (!working) onBack();
  });
  const record = recorder.record,
    matching = !!expectedId && record.id === expectedId;
  const geometry = matching ? recordingTrack(record).segments : [];
  const finish = async (save: boolean) => {
    setWorking(true);
    setError('');
    try {
      let savedId: string | undefined;
      if (expectedId) {
        if (record.id !== expectedId)
          throw new Error('记录已切换，请重新打开结束窗口');
        const final: Recording =
          record.phase === 'finished'
            ? record
            : await recorder.commandAsync('finish', expectedId);
        if (save) savedId = saveRecording(final).id;
        await recorder.commandAsync('clear', expectedId);
      }
      onStop(false);
      if (savedId) onSaved(savedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作未完成，记录保留');
    } finally {
      setWorking(false);
    }
  };
  return (
    <section
      ref={root}
      className="navigation-finish glass"
      role="dialog"
      aria-label="结束本次行程"
      aria-modal="false"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <header>
        <strong>结束本次行程</strong>
        <button disabled={working} onClick={onBack}>
          返回
        </button>
      </header>
      <div className="navigation-finish-scroll">
        {matching ? (
          <>
            <strong>
              {formatDistance(trackDistance(geometry))} ·{' '}
              {record.segments.flat().length}点
            </strong>
            <small>
              {new Date(record.startedAt).toLocaleString('zh-CN')} 开始
            </small>
            {record.startedAt < session.startedAt && (
              <small>数据包含导航前已开始的整次记录。</small>
            )}
          </>
        ) : (
          <>
            <strong>导航经过约 {formatDistance(session.travelled)}</strong>
            <small>本次未开启实走记录，没有可保存的行程轨迹。</small>
          </>
        )}
        <div className="recording-actions">
          <button disabled={working} onClick={() => void finish(false)}>
            直接结束行程
          </button>
          {matching && (
            <button
              className="primary"
              disabled={working || !geometry.length}
              onClick={() => void finish(true)}
            >
              结束并保存
            </button>
          )}
        </div>
        {matching && (
          <>
            <small>
              直接结束将清除本次未保存记录；原路线、照片和已保存行程保留。
            </small>
            <button disabled={working} onClick={() => onStop(true)}>
              {record.phase === 'finished'
                ? '只结束导航，保留待保存记录'
                : record.phase === 'paused'
                  ? '只结束导航，保留暂停记录'
                  : '只结束导航，继续记录'}
            </button>
          </>
        )}
        {working && <small role="status">正在处理最终记录…</small>}
        {error && (
          <p role="alert" className="route-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
