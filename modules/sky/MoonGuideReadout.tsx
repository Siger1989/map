import type { MoonGuide } from './moonGuideGeometry';

export function SkyMoonGuide({ guide, onFindMoon }: { guide: MoonGuide; onFindMoon: () => void }) {
  return <div className="sky-readout" style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
    <span>{guide.message}</span>
    <button type="button" onClick={onFindMoon}>找月亮</button>
  </div>;
}

export function SkyMoonMarker({ guide }: { guide: MoonGuide }) {
  if (!guide.point || guide.state !== 'visible') return null;
  const { x, y } = guide.point;
  return <span aria-hidden="true" style={{
    position: 'absolute', left: x, top: y, width: 22, height: 22, borderRadius: '50%',
    transform: 'translate(-50%, -50%)', border: '1px solid #e2efff', pointerEvents: 'none',
    boxShadow: '0 0 0 1px #142331, inset 0 0 0 1px #142331',
  }}>
    <span style={{
      position: 'absolute', left: '50%', top: 23, transform: 'translateX(-50%)', whiteSpace: 'nowrap',
      color: '#f1f7ff', padding: '2px 5px', borderRadius: 4, fontSize: 11,
      lineHeight: 1.2, background: '#142331e8',
    }}>月亮</span>
  </span>;
}
