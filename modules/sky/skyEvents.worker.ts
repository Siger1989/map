import {
  getAstronomicalSolarVisibility,
  getSolarVisibility,
  type SkyObserver,
  type SkyTimeInterval,
} from './astronomy';
import { terrainHorizonAt, type TerrainHorizon } from './terrainHorizon';

self.onmessage = ({
  data,
}: MessageEvent<{
  day: SkyTimeInterval;
  observer: SkyObserver;
  terrain: TerrainHorizon | null;
}>) => {
  const { day, observer, terrain } = data;
  const visibility = terrain
    ? getSolarVisibility(day, observer, (azimuth) =>
        terrainHorizonAt(terrain, azimuth),
      )
    : getAstronomicalSolarVisibility(day, observer);
  const fallback =
    !!terrain &&
    visibility.status === 'unknown' &&
    visibility.events.length === 0;
  self.postMessage({
    value: fallback
      ? getAstronomicalSolarVisibility(day, observer)
      : visibility,
    flatReference: !terrain || fallback,
  });
};
