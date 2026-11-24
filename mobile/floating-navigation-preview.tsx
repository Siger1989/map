import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpLeft, CircleDot, MapPin, Minus, Plus, X } from 'lucide-react';
import { AppearanceProvider } from '../modules/appearance/AppearanceProvider';
import { pathOf, pointAt } from '../modules/guidance/geometry';
import type { Coordinate } from '../modules/navigation/types';
import road from './preview-data/qingcheng-winding-road.json';
import '../app/globals.css';
import './floating-navigation-preview.css';

const path = pathOf(road.coordinates.map(([longitude, latitude]): Coordinate => [longitude, latitude]));
const positionM = 3120;
const current = pointAt(path, positionM);
const remainingM = path.length - positionM;
const examples = [
  { distanceM: 5520, label: '岔路口' },
  { distanceM: 3920, label: '桥' },
  { distanceM: 4620, label: '观景台' },
];

function distanceKm(meters: number) {
  return `${(meters / 1000).toFixed(2)} km`;
}

function RouteProgress() {
  return <div className="floating-preview-progress">
    <progress aria-label="路线进度" aria-valuetext={`已走 ${distanceKm(positionM)}，剩余 ${distanceKm(remainingM)}`}
      max={path.length} value={positionM}/>
    <div className="floating-preview-progress-distance">
      <span>已走 <strong>{distanceKm(positionM)}</strong></span>
      <span>剩余 <strong>{distanceKm(remainingM)}</strong></span>
    </div>
  </div>;
}

function RouteSketch({ zoom, motion }: { zoom: number; motion: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const draw = () => {
      const width = canvas.clientWidth, height = canvas.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      const size = 0.095 * 1.35 ** zoom;
      const metersPerLongitude = 111320 * Math.cos(current[1] * Math.PI / 180);
      const headingPoint = pointAt(path, positionM + 35);
      const heading = Math.atan2((headingPoint[0] - current[0]) * metersPerLongitude, (headingPoint[1] - current[1]) * 111320);
      const angle = motion ? -heading : 0;
      ctx.translate(width * 0.61, height * 0.54);
      ctx.rotate(angle);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const trace = (points: Coordinate[], color: string) => {
        ctx.beginPath();
        points.forEach(([longitude, latitude], index) => {
          const x = (longitude - current[0]) * metersPerLongitude * size;
          const y = (current[1] - latitude) * 111320 * size;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#10211d';ctx.lineWidth = 11;ctx.stroke();
        ctx.strokeStyle = color;ctx.lineWidth = 7;ctx.stroke();
      };
      const index = path.cumulative.findIndex(distance => distance >= positionM);
      trace([...path.points.slice(0, index), current], '#cd7e44');
      trace([current, ...path.points.slice(index)], '#68c589');
      ctx.rotate(heading);
      ctx.fillStyle = '#5de1f4';
      ctx.strokeStyle = '#102330';ctx.lineWidth = 3;
      ctx.beginPath();ctx.moveTo(0, -17);ctx.lineTo(10, 11);ctx.lineTo(0, 6);ctx.lineTo(-10, 11);ctx.closePath();
      ctx.stroke();ctx.fill();
    };
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    draw();
    return () => observer.disconnect();
  }, [zoom, motion]);
  return <canvas ref={ref} aria-label="青城山路线和高对比度的位置箭头"/>;
}

function FloatingNavigationPreview() {
  const [open, setOpen] = useState(true);
  const [motion, setMotion] = useState(true);
  const [zoom, setZoom] = useState(0);
  const upcoming = examples.filter(item => item.distanceM >= positionM)
    .sort((a, b) => a.distanceM - b.distanceM);
  return <main className="floating-layout-preview">
    <header><h1>悬浮小地图</h1><span>布局示例</span></header>
    {open ? <section className="floating-layout-window" aria-label="悬浮窗口">
      <div className="floating-layout-body">
        <div className="floating-layout-left">
          <div className="floating-layout-map" data-zoom={zoom}>
            <RouteSketch zoom={zoom} motion={motion}/>
            <div className="floating-layout-toolbar" role="group" aria-label="浮窗操作">
              <button type="button" aria-label="返回地图" onClick={() => setOpen(false)}><ArrowUpLeft size={15}/></button>
              <button type="button" className="floating-preview-north" aria-label={motion ? '运动朝上，切换到指北' : '指北，切换到运动朝上'}
                onClick={() => setMotion(value => !value)}>N</button>
              <span className="floating-preview-record" role="img" aria-label="记录中" title="记录中样式示例"><CircleDot size={15}/></span>
              <button type="button" aria-label="关闭浮窗" onClick={() => setOpen(false)}><X size={15}/></button>
            </div>
            <div className="floating-preview-zoom">
              <button type="button" aria-label="放大悬浮地图" disabled={zoom === 3} onClick={() => setZoom(value => value + 1)}><Plus size={16}/></button>
              <button type="button" aria-label="缩小悬浮地图" disabled={zoom === -2} onClick={() => setZoom(value => value - 1)}><Minus size={16}/></button>
            </div>
          </div>
          <RouteProgress/>
        </div>
        <aside aria-label="前方路段和标记，由近到远">
          <ol>{upcoming.map(item => <li key={item.distanceM}>
            <strong>{((item.distanceM - positionM) / 1000).toFixed(1)} 公里</strong>
            <span><MapPin size={12}/> {item.label}</span>
          </li>)}</ol>
          <span className="floating-preview-location"><i/>当前位置</span>
        </aside>
      </div>
    </section> : <button type="button" className="floating-layout-reopen" onClick={() => setOpen(true)}>打开浮窗</button>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<AppearanceProvider><FloatingNavigationPreview/></AppearanceProvider>);
