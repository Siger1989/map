import type { RefObject, ComponentProps } from 'react';
import { CollectionsPanel } from '../collections/CollectionsPanel';
import { collectionPreviewPoints } from '../collections/previewBounds';
import { annotationViewZoom } from '../annotations/view';
import { sharePlanned, type ShareRoute } from '../routeShare/data';
import type { CollectionViewRef } from '../collections/useCollectionView';
import type { MapHandle } from '../map/TerrainMap';
import type { Coordinate } from '../navigation/types';
import type { RouteFavorite } from '../navigation/favorites';
import type { ControlPanel } from '../controls/ControlDock';
import type { usePosition } from '../position/usePosition';
import type { useFollowPosition } from '../position/useFollowPosition';
import type { useNavigation } from '../navigation/useNavigation';
import type { useAnnotations } from '../annotations/useAnnotations';
import type { useTripPhotos } from '../photos/useTripPhotos';
import type { useAreas } from '../areas/useAreas';
import type { useMeasurement } from '../measurement/useMeasurement';
import type { useSavedSection } from '../section/useSavedSection';
type Base = ComponentProps<typeof CollectionsPanel>;
type Props = {
  collectionView: CollectionViewRef;
  collectionReturn: RefObject<boolean>;
  map: RefObject<MapHandle | null>;
  anchor: Coordinate;
  position: ReturnType<typeof usePosition>;
  follow: ReturnType<typeof useFollowPosition>;
  navigation: ReturnType<typeof useNavigation>;
  tracks: Base['tracks'];
  annotations: ReturnType<typeof useAnnotations>;
  setPanel: (p: ControlPanel) => void;
  collectionOutputKey: string | null;
  collectionSelectedKeys: string[];
  photos: ReturnType<typeof useTripPhotos>;
  areas: ReturnType<typeof useAreas>;
  measurement: ReturnType<typeof useMeasurement>;
  setProfileOpen: (v: boolean) => void;
  setSectionEditing: (v: boolean) => void;
  setAreaEditing: (v: boolean) => void;
  sections: ReturnType<typeof useSavedSection>;
  setHiddenSectionId: (s: string | null) => void;
  openSection: (s: string) => void;
  setShareTarget: (s: ShareRoute | null) => void;
  shareTrackById: (s: string) => void;
  favorites: Base['favorites'];
  navigateFavorite: (f: RouteFavorite) => void;
  navigateTrack: (s: string) => void;
  savedNavigationError: string;
  openRoute: (s: string) => void;
};
/** The collection-to-map adapter keeps object visibility separate from opening a detail page. */
export function WorkbenchCollections({
  collectionView,
  collectionReturn,
  map,
  anchor,
  position,
  follow,
  navigation,
  tracks,
  annotations,
  setPanel,
  collectionOutputKey,
  collectionSelectedKeys,
  photos,
  areas,
  measurement,
  setProfileOpen,
  setSectionEditing,
  setAreaEditing,
  sections,
  setHiddenSectionId,
  openSection,
  setShareTarget,
  shareTrackById,
  favorites,
  navigateFavorite,
  navigateTrack,
  savedNavigationError,
  openRoute,
}: Props) {
  return (
    <CollectionsPanel
      view={collectionView}
      onLeave={() => {
        collectionReturn.current = true;
      }}
      mapCenter={map.current?.centerCoordinate() ?? anchor}
      onLocate={(entry) => {
        position.free();
        follow.pause();
        if (entry.kind === 'route') navigation.restore(entry.route);
        if (entry.kind === 'track') tracks.select(entry.track.id);
        map.current?.fitCollection(collectionPreviewPoints(entry));
      }}
      onClose={() => setPanel(null)}
      initialOutputKey={collectionOutputKey}
      initialSelectedKeys={collectionSelectedKeys}
      photos={photos.items}
      areas={areas.items}
      measurements={measurement.saved.items}
      onMeasurement={(id) => {
        const item = measurement.saved.items.find((m) => m.id === id);
        if (!item) return;
        tracks.finish();
        tracks.select(null);
        annotations.select(null);
        navigation.setPicking(null);
        setPanel(null);
        setProfileOpen(false);
        setSectionEditing(false);
        position.free();
        measurement.load(item);
        map.current?.fitRoute(item.points.map((p) => p.coordinates));
      }}
      onArea={(id) => {
        const a = areas.items.find((a) => a.id === id);
        if (a) {
          areas.select(id);
          annotations.select(null);
          tracks.select(null);
          map.current?.fitRoute(a.boundary);
          setAreaEditing(true);
          setPanel(null);
        }
      }}
      annotations={annotations.items}
      sections={sections.items}
      onAnnotation={(id) => {
        const item = annotations.items.find((a) => a.id === id);
        if (!item) return;
        annotations.select(id);
        tracks.select(null);
        setProfileOpen(false);
        map.current?.focusPoint(item.coordinates, annotationViewZoom(item));
        setPanel('annotations');
      }}
      onSection={(id) => {
        setPanel(null);
        if (
          sections.items.find((s) => s.id === id)?.settings.enabled === false
        ) {
          setHiddenSectionId(id);
          return;
        }
        openSection(id);
      }}
      onShareRoute={(favorite) =>
        setShareTarget(sharePlanned(favorite.route, favorite.name))
      }
      onShareTrack={shareTrackById}
      favorites={favorites}
      tracks={tracks}
      onNavigateRoute={navigateFavorite}
      onNavigateTrack={navigateTrack}
      navigationError={savedNavigationError}
      onRoute={(favorite) => {
        navigation.restore(favorite);
        map.current?.fitRoute(favorite.route.coordinates);
        setPanel(null);
      }}
      onTrack={(id) => {
        openRoute(id);
        const track = tracks.saved.find((t) => t.id === id);
        if (track) map.current?.fitRoute(track.segments.flat());
      }}
    />
  );
}
