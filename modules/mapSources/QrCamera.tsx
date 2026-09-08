import { useEffect, useRef, useState } from 'react';
import { decodeQr } from './qr';
import {
  cameraError,
  openCamera,
  stopCamera,
  type CameraChoice,
} from './camera';

export function QrCamera({
  onRead,
  onClose,
  label = '对准地图图源或山兔路线二维码',
}: {
  onRead: (text: string) => void;
  onClose: () => void;
  label?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [activeDevice, setActiveDevice] = useState('');
  const [cameras, setCameras] = useState<CameraChoice[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const callback = useRef(onRead);
  callback.current = onRead;
  useEffect(() => {
    setError('');
    setReady(false);
    let disposed = false,
      stream: MediaStream | undefined,
      timer: ReturnType<typeof setTimeout>;
    const stop = () => {
      disposed = true;
      clearTimeout(timer);
      stopCamera(stream);
      if (video.current) video.current.srcObject = null;
    };
    const hidden = () => {
      // Permission dialogs may hide the page before a stream has been granted.
      if (document.hidden && stream) {
        stop();
        setReady(false);
        setError('扫码已暂停，返回后点“重新打开”。');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error('相机不可用');
        const opened = await openCamera(
          navigator.mediaDevices,
          deviceId,
          () => !disposed,
        );
        stream = opened.stream;
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!video.current) {
          stop();
          return;
        }
        setCameras(opened.cameras);
        setActiveDevice(opened.deviceId);
        if (document.hidden) {
          hidden();
          return;
        }
        video.current.srcObject = stream;
        await video.current.play();
        if (disposed) return;
        setReady(true);
        const scan = () => {
          if (disposed) return;
          try {
            if (
              video.current &&
              video.current.readyState >= 2 &&
              video.current.videoWidth &&
              video.current.videoHeight
            ) {
              const text = decodeQr(
                video.current,
                video.current.videoWidth,
                video.current.videoHeight,
              );
              if (text) {
                stop();
                callback.current(text);
                return;
              }
            }
            timer = setTimeout(scan, 300);
          } catch {
            stop();
            setReady(false);
            setError('画面读取失败，请重新打开扫码或选择二维码图片。');
          }
        };
        scan();
      } catch (failure) {
        if (!disposed) {
          stop();
          setReady(false);
          setError(cameraError(failure));
        }
      }
    })();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [deviceId, attempt]);
  return (
    <div className="map-camera">
      <p>{label}</p>
      <video ref={video} muted autoPlay playsInline aria-label="扫码相机预览" />
      {!ready && !error && <p role="status">正在打开后置镜头…</p>}
      {cameras.length > 1 && (
        <label>
          镜头
          <select
            aria-label="扫码镜头"
            value={deviceId || activeDevice}
            onChange={(event) => setDeviceId(event.target.value)}
          >
            {cameras.map((camera) => (
              <option key={camera.deviceId} value={camera.deviceId}>
                {camera.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="map-source-hint">
        完整画面不裁切；如果视野太近，请切换镜头并让二维码完整入镜。
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="map-source-actions">
        <button onClick={() => setAttempt((v) => v + 1)}>重新打开</button>
        <button onClick={onClose}>关闭扫码</button>
      </div>
    </div>
  );
}
