import { useEffect, useRef, useState } from 'react';
import { decodeQr } from './qr';

export function QrCamera({
  onRead,
  onClose,
}: {
  onRead: (text: string) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const callback = useRef(onRead);
  callback.current = onRead;
  useEffect(() => {
    let disposed = false,
      stream: MediaStream | undefined,
      timer: ReturnType<typeof setTimeout>;
    const stop = () => {
      disposed = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
    const hidden = () => {
      if (document.hidden) {
        stop();
        setError('扫码已暂停，请关闭后重新打开');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error('相机不可用');
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
          },
          audio: false,
        });
        if (disposed) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const scan = () => {
          if (disposed) return;
          if (video.current?.videoWidth) {
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
        };
        scan();
      } catch {
        if (!disposed) {
          stop();
          setError(
            '相机未开启。可改用“二维码图片”，或在系统设置中允许相机权限。',
          );
        }
      }
    })();
    return () => {
      stop();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  return (
    <div className="map-camera">
      <p>对准地图图源二维码</p>
      <video ref={video} muted playsInline aria-label="扫码相机预览" />
      {error && <p role="alert">{error}</p>}
      <button onClick={onClose}>关闭扫码</button>
    </div>
  );
}
