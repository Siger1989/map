import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from '../tracks/drawing';
import type { RoadSnapper } from '../tracks/roadSnapping';
import type { WatchProjection } from '../objectTransform/projection';
export type MapHandle = {
  groundElevation: (coordinates: Coordinate) => number | null;
  centerCoordinate: () => Coordinate | null;
  watchObjectProjection: WatchProjection;
  sectionCenter: () => {
    center: [number, number];
    altitude: number;
    width: number;
    heading: number;
  } | null;
  refreshSection: () => void;
  snapRoad: RoadSnapper;
  snapRiver: RoadSnapper;
  zoom: (amount: number) => void;
  north: () => void;
  reset: () => void;
  view: (pitch: number, bearing: number, animate?: boolean) => void;
  refreshSatellite: () => void;
  refreshGeology: () => void;
  inspect: () => unknown;
  focusPoint: (coordinates: Coordinate, zoom?: number) => void;
  fitRoute: (coordinates: Coordinate[]) => void;
  fitCollection: (
    coordinates: Coordinate[],
    padding?: { top: number; right: number; bottom: number; left: number },
  ) => void;
  previewRoute: (coordinates: Coordinate | null) => void;
  followPosition: (
    coordinates: Coordinate,
    animate?: boolean,
    maximumZoom?: number,
  ) => boolean;
  toCoordinate: (point: ScreenPoint) => Coordinate | null;
  stop: () => void;
  toScreen: (coordinate: Coordinate) => ScreenPoint | null;
  magnify: (target: HTMLCanvasElement, point: ScreenPoint) => () => void;
};
