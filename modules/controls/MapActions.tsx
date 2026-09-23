import { type ReactNode } from 'react';
import {
  Minus,
  Plus,
  Scan,
} from 'lucide-react';
import { PositionDock } from '../position/PositionDock';
import type { DirectionMode, PositionFix } from '../position/types';

/** Home chrome; camera, positioning and route state stay with their owners. */
export function MapActions(props: {
  terrain: boolean;
  elevationControl?: ReactNode;
  compact?: boolean;
  bearing: number;
  onZoom: (amount: number) => void;
  onNorth: () => void;
  onDimension: () => void;
  onLocate: () => void;
  onLocateAndFollow?: () => void;
  onDirection?: (mode: DirectionMode) => void;
  directionStatus?: string;
  locating: boolean;
  watching: boolean;
  following: boolean;
  followBlocked: boolean;
  direction: DirectionMode;
  onStopLocation: () => void;
  sectionActive: boolean;
  networkAvailable: boolean;
  networkMode: boolean;
  onNetwork: () => void;
  onBoxSelect: () => void;
  boxSelecting?: boolean;
  onOverview?: () => void;
  fix?: PositionFix | null;
  showCoordinates?: boolean;
  displayControl?: ReactNode;
  layerControl?: ReactNode;
  viewControl?: ReactNode;
  markControl?: ReactNode;
}) {
  return (
    <>
      <PositionDock
        direction={props.direction}
        following={props.following}
        locating={props.locating}
        blocked={props.followBlocked}
        onLocate={props.onLocate}
        onLocateAndFollow={props.onLocateAndFollow}
        onDirection={props.onDirection}
        directionStatus={props.directionStatus}
        fix={props.fix}
        showCoordinates={props.showCoordinates}
        markControl={props.markControl}
      >
        {props.layerControl}
        <button
          className="position-dock-button glass"
          aria-label="放大地图"
          onClick={() => props.onZoom(1)}
        >
          <Plus size={23} />
        </button>
        <button
          className="position-dock-button glass"
          aria-label="缩小地图"
          onClick={() => props.onZoom(-1)}
        >
          <Minus size={23} />
        </button>
        {props.displayControl}
        {props.elevationControl}
      </PositionDock>
      <div className="home-camera-control">{props.viewControl}</div>
      <nav className="home-map-actions" aria-label="地图快捷操作">
        <button
          className="dimension-button"
          disabled={props.sectionActive}
          aria-label={props.terrain ? '切换二维地图' : '切换三维地形'}
          aria-pressed={props.terrain}
          onClick={props.onDimension}
        >
          {props.terrain ? '3D' : '2D'}
        </button>
        <button
          className="icon-button"
          aria-label="框选对象"
          aria-pressed={!!props.boxSelecting}
          onClick={props.onBoxSelect}
        >
          <Scan size={21} />
          <small>框选</small>
        </button>
      </nav>
    </>
  );
}
