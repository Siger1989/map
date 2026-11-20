import { useEffect, useRef } from 'react';
import type { SkyObserver } from './astronomy';
import type { DeviceSkyOptics, DeviceSkyPose } from './deviceSkyCamera';
import { createSatelliteTerrain, type JourneyTerrainBuffer, type SatelliteTerrainCamera, type SatelliteTerrainStatus } from './satelliteTerrainRenderer';

import type { JourneyTerrainRoute } from './journeyRouteOverlay';

interface Props {
  observer: SkyObserver;
  pose: DeviceSkyPose;
  optics: DeviceSkyOptics;
  width: number;
  height: number;
  eyeHeightMeters?: number;
  journeyRoute?: JourneyTerrainRoute;
  retryKey?: number;
  onBuffer?: (buffer: JourneyTerrainBuffer) => void;
  onCameraResolved?: (camera: SatelliteTerrainCamera) => void;
  onRender?: () => void;
  onStatus?: (status: SatelliteTerrainStatus) => void;
  canvasRef?: (canvas: HTMLCanvasElement | null) => void;
}

export function SatelliteTerrainCanvas(props: Props) {
  const element = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<ReturnType<typeof createSatelliteTerrain> | null>(null);
  const view = useRef(props);
  const lastStatus = useRef<SatelliteTerrainStatus | null>(null);
  const request = useRef(0);
  view.current = props;

  function publish(status: SatelliteTerrainStatus) {
    if (lastStatus.current === status) return;
    lastStatus.current = status;
    view.current.onStatus?.(status);
    if (element.current) element.current.dataset.status = status;
  }

  function queue() {
    if (request.current) return;
    request.current = requestAnimationFrame(() => {
      request.current = 0;
      if (!renderer.current) return;
      const { observer, pose, optics, width, height, eyeHeightMeters, journeyRoute, onCameraResolved } = view.current;
      publish(renderer.current.draw(observer, pose, optics, width, height, eyeHeightMeters, journeyRoute, onCameraResolved));
      if (journeyRoute) view.current.onBuffer?.(renderer.current.journeyBuffer());
      view.current.onRender?.();
    });
  }

  useEffect(() => {
    const canvas = element.current;
    if (!canvas) return;
    function initialize() {
      try {
        renderer.current = createSatelliteTerrain(canvas!, queue);
        queue();
      } catch {
        publish('error');
      }
    }
    function lost(event: Event) {
      event.preventDefault();
      renderer.current?.dispose();
      renderer.current = null;
      publish('error');
    }
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', initialize);
    initialize();
    return () => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', initialize);
      cancelAnimationFrame(request.current);
      request.current = 0;
      renderer.current?.dispose();
      renderer.current = null;
    };
  }, []);

  useEffect(() => {
    props.canvasRef?.(element.current);
    return () => props.canvasRef?.(null);
  }, [props.canvasRef]);

  useEffect(() => { queue(); }, [props.observer, props.pose, props.optics, props.width, props.height, props.eyeHeightMeters, props.journeyRoute]);

  useEffect(() => {
    if (props.retryKey) {
      renderer.current?.retryJourneyBuffer();
      queue();
    }
  }, [props.retryKey]);

  return <canvas ref={element} aria-hidden="true" data-layer="satellite-terrain" style={{
    position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none',
  }}/>;
}
