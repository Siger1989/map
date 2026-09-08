import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { routeBounds } from '../routeShare/data';

/** A separate flat overview: changing direction never moves the main map. */
export function RouteMiniMap({
  coordinates,
  color = '#e5934f',
}: {
  coordinates: Coordinate[];
  color?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const geometry = JSON.stringify(coordinates);
  useEffect(() => {
    let disposed = false,
      map: import('maplibre-gl').Map | undefined;
    setError('');
    const timer = setTimeout(() => {
      if (!disposed) setError('底图加载较慢，路线与起终点仍可查看');
    }, 15000);
    void import('maplibre-gl')
      .then((ml) => {
        if (disposed || !container.current) return;
        ml.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
        const points: Coordinate[] = JSON.parse(geometry),
          bounds = routeBounds([points]);
        const center = (bounds[0][0] + bounds[1][0]) / 2;
        const unwrap = ([lng, lat]: Coordinate): Coordinate => [
          center + ((((lng - center + 180) % 360) + 360) % 360) - 180,
          lat,
        ];
        map = new ml.Map({
          container: container.current,
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          bounds,
          fitBoundsOptions: { padding: 30, maxZoom: 16 },
          style: {
            version: 8,
            sources: {
              base: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 19,
              },
              route: {
                type: 'geojson',
                data: {
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'LineString',
                    coordinates: points.map(unwrap),
                  },
                },
              },
            },
            layers: [
              {
                id: 'background',
                type: 'background',
                paint: { 'background-color': '#dce6d5' },
              },
              { id: 'base', type: 'raster', source: 'base' },
              {
                id: 'outline',
                type: 'line',
                source: 'route',
                paint: { 'line-color': '#fff', 'line-width': 6 },
              },
              {
                id: 'route',
                type: 'line',
                source: 'route',
                paint: { 'line-color': color, 'line-width': 3 },
              },
            ],
          },
        });
        map.once('idle', () => {
          clearTimeout(timer);
          if (!disposed) setError('');
        });
        const closed =
          points[0][0] === points.at(-1)![0] &&
          points[0][1] === points.at(-1)![1];
        for (const [i, point] of [points[0], points.at(-1)!].entries()) {
          const element = document.createElement('span');
          element.className = `route-endpoint-badge ${i ? 'is-end' : 'is-start'}`;
          element.textContent = i ? '终' : '起';
          new ml.Marker({
            element,
            offset: closed ? [i ? 14 : -14, 0] : [0, 0],
          })
            .setLngLat(unwrap(point))
            .addTo(map);
        }
      })
      .catch(() => {
        if (!disposed) setError('缩略底图暂不可用');
      });
    return () => {
      disposed = true;
      clearTimeout(timer);
      map?.remove();
    };
  }, [geometry, color]);
  return (
    <section
      className="route-mini-overview"
      aria-label="路线缩略图：绿色起点，红色终点"
    >
      <div ref={container} className="route-mini-map" />
      <span className="route-mini-north">北 ↑</span>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
      >
        © OpenStreetMap
      </a>
      {error && <small role="status">{error}</small>}
    </section>
  );
}
