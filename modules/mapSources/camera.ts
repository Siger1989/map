export type CameraChoice = { deviceId: string; label: string };
const rear = /back|rear|environment|后置|背面/i;
const front = /front|user|前置|facetime/i;
const tele = /tele|长焦|periscope|潜望/i;
const wide = /wide|main|主摄|广角/i;

export function preferredCamera(devices: CameraChoice[], current?: string) {
  const score = (device: CameraChoice) =>
    (front.test(device.label) ? -100 : 0) +
    (rear.test(device.label) ? 20 : 0) +
    (wide.test(device.label) ? 15 : 0) -
    (tele.test(device.label) ? 40 : 0);
  const best = devices.reduce<CameraChoice | undefined>(
    (a, b) => (!a || score(b) > score(a) ? b : a),
    undefined,
  );
  const selected = devices.find((d) => d.deviceId === current);
  // Opaque device IDs do not tell us focal length. Keep the system choice on ties.
  return best && score(best) > (selected ? score(selected) : 0)
    ? best.deviceId
    : current;
}

export function stopCamera(stream?: MediaStream) {
  stream?.getTracks().forEach((track) => track.stop());
}

export async function openCamera(
  media: MediaDevices,
  deviceId: string,
  current: () => boolean,
) {
  let stream = await media.getUserMedia({
    audio: false,
    video: {
      ...(deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: 'environment' } }),
      width: { ideal: 1280 },
    },
  });
  try {
    const check = () => {
      if (!current()) {
        throw new DOMException('Scanner closed', 'AbortError');
      }
    };
    check();
    let cameras: CameraChoice[] = [];
    try {
      const devices = await media.enumerateDevices();
      check();
      cameras = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `镜头 ${i + 1}`,
        }));
    } catch (error) {
      if (!current()) {
        throw error;
      }
    }
    const selected = stream.getVideoTracks()[0]?.getSettings().deviceId;
    const preferred = deviceId || preferredCamera(cameras, selected);
    if (!deviceId && preferred && preferred !== selected) {
      stopCamera(stream);
      try {
        stream = await media.getUserMedia({
          audio: false,
          video: {
            deviceId: { exact: preferred },
          width: { ideal: 1280 },
          },
        });
      } catch {
        check();
        stream = await media.getUserMedia({
          audio: false,
          video: selected
            ? { deviceId: { exact: selected } }
            : { facingMode: { ideal: 'environment' } },
        });
      }
      check();
    }
    const track = stream.getVideoTracks()[0];
    const caps = track?.getCapabilities?.() as
      | (MediaTrackCapabilities & {
          zoom?: { min: number; max: number; step: number };
          focusMode?: string[];
        })
      | undefined;
    // Optical lens and digital zoom are separate. Reset only a capability the device exposes.
    if (caps?.zoom) {
      try {
        await track.applyConstraints({
          advanced: [{ zoom: caps.zoom.min } as MediaTrackConstraintSet],
        });
      } catch {
        /* Optional controls vary by WebView. */
      }
      check();
    }
    if (caps?.focusMode?.includes('continuous')) {
      try {
        await track.applyConstraints({
          advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
        });
      } catch {}
      check();
    }
    return {
      stream,
      cameras,
      deviceId: track?.getSettings().deviceId ?? deviceId,
    };
  } catch (error) {
    stopCamera(stream);
    throw error;
  }
}

export function cameraError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return '相机权限未允许，请在系统设置中允许后重试。';
  if (name === 'NotReadableError')
    return '镜头被占用，请关闭其他相机应用后重试。';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return '此镜头不可用，请切换镜头或重新打开扫码。';
  return '相机未能启动，请重试或返回选择“二维码图片”。';
}
