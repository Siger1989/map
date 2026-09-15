import type { RefObject } from 'react';
import {
  RouteCard,
  RouteDetails,
  RouteMarkerTypes,
} from '../tracks/RouteViews';
import { TripDetails } from '../outdoor/TripDetails';
import { isTrip } from '../outdoor/tripData';
import { DRAFT_ID } from '../tracks/editing';
import { markerChainage, type TrackLinePoint } from '../tracks/linePoint';
import { trackNavigation } from '../guidance/savedRoute';
import type { ManualTrack } from '../tracks/drawing';
import type { ManualTracksState } from '../tracks/useManualTracks';
import type { PhotoPlacementJob } from '../photos/PhotoPlacement';
import type { ControlPanel } from '../controls/ControlDock';
import type { MapHandle } from '../map/TerrainMap';
import type { RouteFavorite } from '../navigation/favorites';
import type { useAnnotations } from '../annotations/useAnnotations';
import type { useTripPhotos } from '../photos/useTripPhotos';
import type { useRouteDisplay } from '../routeDisplay/useRouteDisplay';
type Props = {
  routeWindow: 'card' | 'details' | 'marker';
  photoPlacement: PhotoPlacementJob | null;
  railTrack: ManualTrack;
  linePoint: TrackLinePoint | null;
  activeAlternative: string;
  savedNavigationError: string;
  tracks: ManualTracksState;
  collectionReturn: RefObject<boolean>;
  returnCollections: () => void;
  setTrackLinePoint: (p: TrackLinePoint | null) => void;
  navigateTrack: (id: string) => void;
  setNavigationTarget: (t: RouteFavorite | null) => void;
  setSavedNavigationError: (s: string) => void;
  setPhotoPlacement: (p: PhotoPlacementJob | null) => void;
  setRouteWindow: (w: 'card' | 'details' | 'marker') => void;
  beginRouteEdit: (t: ManualTrack) => void;
  annotations: ReturnType<typeof useAnnotations>;
  photos: ReturnType<typeof useTripPhotos>;
  map: RefObject<MapHandle | null>;
  setPhotoGroup: (ids: string[]) => void;
  setRouteChild: (b: boolean) => void;
  setPanel: (p: ControlPanel) => void;
  setOutdoorPhotos: (b: boolean) => void;
  shareTrackById: (id: string) => void;
  openRoute: (id: string) => void;
  routeDisplay: ReturnType<typeof useRouteDisplay>;
};
/** Composition for a selected spatial route or timed trip; owns the transitions between their shared windows. */
export function WorkbenchRouteWindows({
  routeWindow,
  photoPlacement,
  railTrack,
  linePoint,
  activeAlternative,
  savedNavigationError,
  tracks,
  collectionReturn,
  returnCollections,
  setTrackLinePoint,
  navigateTrack,
  setNavigationTarget,
  setSavedNavigationError,
  setPhotoPlacement,
  setRouteWindow,
  beginRouteEdit,
  annotations,
  photos,
  map,
  setPhotoGroup,
  setRouteChild,
  setPanel,
  setOutdoorPhotos,
  shareTrackById,
  openRoute,
  routeDisplay,
}: Props) {
  return (
    <>
      {routeWindow === 'card' && !photoPlacement && (
        <RouteCard
          track={railTrack}
          point={linePoint}
          alternative={activeAlternative}
          error={savedNavigationError || tracks.error}
          onBack={() => {
            if (collectionReturn.current) {
              returnCollections();
              return;
            }
            tracks.select(null);
            setTrackLinePoint(null);
          }}
          onNavigate={() => {
            if (railTrack.id !== DRAFT_ID) {
              navigateTrack(railTrack.id);
              return;
            }
            const id = tracks.saveForMarker();
            if (!id) return;
            try {
              setNavigationTarget(
                trackNavigation(
                  { ...railTrack, id },
                  Date.now(),
                  'pedestrian',
                  tracks.saved,
                  activeAlternative,
                ),
              );
            } catch (e) {
              setSavedNavigationError(
                e instanceof Error ? e.message : '无法导航',
              );
            }
          }}
          onPhoto={() => {
            if (linePoint)
              setPhotoPlacement({
                trackId: isTrip(railTrack) ? railTrack.id : undefined,
                coordinate: linePoint.coordinate,
              });
          }}
          onMarker={() => setRouteWindow('marker')}
          onEdit={() => beginRouteEdit(railTrack)}
          onDetails={() => setRouteWindow('details')}
        />
      )}
      {routeWindow === 'details' && !photoPlacement && isTrip(railTrack) && (
        <TripDetails
          key={railTrack.id}
          track={railTrack}
          markers={annotations.items}
          photos={photos.items}
          onBack={() =>
            collectionReturn.current
              ? returnCollections()
              : setRouteWindow('card')
          }
          onPoint={(p) => {
            setTrackLinePoint(p);
            setRouteWindow('card');
            map.current?.focusPoint(p.coordinate);
          }}
          onPhoto={(id) => {
            photos.setSelected(id);
            setPhotoGroup([id]);
          }}
          onMarker={(id) => {
            annotations.select(id);
            setRouteChild(true);
            setPanel('annotations');
          }}
          onScan={() => {
            tracks.select(railTrack.id);
            setOutdoorPhotos(true);
            setPanel('outdoor');
          }}
          onShare={() => shareTrackById(railTrack.id)}
          onNavigate={() => navigateTrack(railTrack.id)}
          onHide={(hide) => tracks.showTrack(railTrack.id, !hide)}
          onRoute={openRoute}
          error={tracks.error}
          onDelete={() => {
            if (!tracks.remove(railTrack.id)) return false;
            setTrackLinePoint(null);
            setRouteWindow('card');
            return true;
          }}
        />
      )}
      {routeWindow === 'details' && !photoPlacement && !isTrip(railTrack) && (
        <RouteDetails
          track={railTrack}
          onShowMetric={(mode) => {
            routeDisplay.choose(railTrack.id);
            routeDisplay.update({ mode, legend: true });
            setRouteWindow('card');
          }}
          alternative={activeAlternative}
          onCondition={(color, value) =>
            tracks.setColorCondition(railTrack.id, color, value)
          }
          markers={annotations.items}
          photos={photos.items}
          onBack={() => setRouteWindow('card')}
          onShare={() => shareTrackById(railTrack.id)}
          deleteError={tracks.error}
          onDelete={() => {
            if (!tracks.remove(railTrack.id)) return false;
            setTrackLinePoint(null);
            setRouteWindow('card');
            return true;
          }}
          onMarker={(id) => {
            annotations.select(id);
            setRouteChild(true);
            setPanel('annotations');
          }}
          onPhoto={(id) => {
            photos.setSelected(id);
            setPhotoGroup([id]);
          }}
        />
      )}
      {routeWindow === 'marker' && (
        <RouteMarkerTypes
          error={annotations.error || tracks.error}
          onBack={() => setRouteWindow('card')}
          onAdd={(kind) => {
            if (!linePoint) return;
            const id =
              railTrack.id === DRAFT_ID ? tracks.saveForMarker() : railTrack.id;
            if (!id) return;
            if (
              annotations.add(kind, linePoint.coordinate, {
                trackId: id,
                distance: markerChainage(
                  railTrack.segments,
                  linePoint.coordinate,
                ).distance,
              })
            ) {
              setRouteWindow('card');
              setRouteChild(true);
              setPanel('annotations');
            }
          }}
        />
      )}
    </>
  );
}
