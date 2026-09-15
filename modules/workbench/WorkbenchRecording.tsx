import type { RefObject } from 'react';
import { RecordingWindow } from '../outdoor/RecordingWindow';
import { NavigationFinish } from '../outdoor/NavigationFinish';
import type { VisiblePhoto } from '../photos/storage';
import type { ShareRoute } from '../routeShare/data';
import type { ControlPanel } from '../controls/ControlDock';
import type { MapHandle } from '../map/TerrainMap';
import type { useRecording } from '../outdoor/useRecording';
import type { usePosition } from '../position/usePosition';
import type { useFollowPosition } from '../position/useFollowPosition';
import type { useNavigation } from '../navigation/useNavigation';
import type { useGuidance } from '../guidance/useGuidance';
import type { useRouteEditor } from '../tracks/useRouteEditor';
type Props = {
  selectedPhoto: VisiblePhoto | undefined;
  shareTarget: ShareRoute | null;
  recorder: ReturnType<typeof useRecording>;
  recordWindowOpen: boolean;
  panel: ControlPanel;
  editor: ReturnType<typeof useRouteEditor>;
  navigationEnding: boolean;
  setRecordWindowOpen: (v: boolean) => void;
  setPanel: (p: ControlPanel) => void;
  openRoute: (id: string) => void;
  follow: ReturnType<typeof useFollowPosition>;
  position: ReturnType<typeof usePosition>;
  map: RefObject<MapHandle | null>;
  setOutdoorPhotos: (v: boolean) => void;
  navigation: ReturnType<typeof useNavigation>;
  guidance: ReturnType<typeof useGuidance>;
  setNavigationEnding: (v: boolean) => void;
};
/** Recording remains independent of navigation. Finishing navigation makes save/discard an explicit choice. */
export function WorkbenchRecording({
  selectedPhoto,
  shareTarget,
  recorder,
  recordWindowOpen,
  panel,
  editor,
  navigationEnding,
  setRecordWindowOpen,
  setPanel,
  openRoute,
  follow,
  position,
  map,
  setOutdoorPhotos,
  navigation,
  guidance,
  setNavigationEnding,
}: Props) {
  return (
    <>
      {' '}
      {!selectedPhoto && !shareTarget && (
        <RecordingWindow
          recorder={recorder}
          open={
            recordWindowOpen &&
            panel === null &&
            !editor.session &&
            !navigationEnding
          }
          onOpen={(value) => {
            setRecordWindowOpen(value);
            if (value) setPanel(null);
          }}
          onSaved={(id) => {
            setRecordWindowOpen(false);
            openRoute(id);
          }}
          onShow={(points) => {
            follow.pause();
            position.free();
            map.current?.fitRoute(points);
            setRecordWindowOpen(false);
          }}
          onPhotos={() => {
            setRecordWindowOpen(false);
            setOutdoorPhotos(true);
            setPanel('outdoor');
          }}
          points={navigation.route?.coordinates ?? []}
        />
      )}
      {navigationEnding && guidance.session && (
        <NavigationFinish
          session={guidance.session}
          recorder={recorder}
          onBack={() => setNavigationEnding(false)}
          onStop={(keepRecord) => {
            guidance.stop();
            setNavigationEnding(false);
            setRecordWindowOpen(keepRecord);
          }}
          onSaved={(id) => {
            setRecordWindowOpen(false);
            openRoute(id);
          }}
        />
      )}
    </>
  );
}
