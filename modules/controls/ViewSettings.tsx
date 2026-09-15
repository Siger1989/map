import { X } from 'lucide-react';
import type { DirectionMode } from '../position/types';
export function ViewSettings({
  pitch,
  bearing,
  direction,
  terrain,
  disabled,
  error,
  onClose,
  onFree,
  onNorth,
  onDevice,
  onAngle,
}: {
  pitch: number;
  bearing: number;
  direction: DirectionMode;
  terrain: boolean;
  disabled: boolean;
  error?: string;
  onClose: () => void;
  onFree: () => void;
  onNorth: () => void;
  onDevice: () => void;
  onAngle: (pitch: number, bearing: number) => void;
}) {
  return (
    <section className="map-small-window glass" aria-label="视角设置">
      <header>
        <strong>视角</strong>
        <button aria-label="关闭视角" onClick={onClose}>
          <X size={15} />
        </button>
      </header>
      <div className="view-mode-buttons">
        <button aria-pressed={direction === 'free'} onClick={onFree}>
          自由调整
        </button>
        <button aria-pressed={direction === 'north'} onClick={onNorth}>
          正北朝上
        </button>
        <button
          aria-pressed={direction === 'device'}
          disabled={disabled}
          onClick={onDevice}
        >
          跟随手机
        </button>
      </div>
      <label>
        朝向 <span>{Math.round(bearing)}°</span>
        <input
          type="range"
          aria-label="视角朝向"
          min="-180"
          max="180"
          value={bearing}
          onChange={(e) => onAngle(pitch, Number(e.target.value))}
        />
      </label>
      <label>
        俯仰 <span>{Math.round(pitch)}°</span>
        <input
          type="range"
          aria-label="视角俯仰"
          min="0"
          max="80"
          value={terrain ? pitch : 0}
          disabled={!terrain || disabled}
          onChange={(e) => onAngle(Number(e.target.value), bearing)}
        />
      </label>
      {!terrain && <small>二维地图 · 俯仰为0°</small>}
      {error && <small role="status">{error}</small>}
    </section>
  );
}
