import {
  PhotoPlacement,
  type PhotoPlacementJob,
} from '../photos/PhotoPlacement';
import type { ManualTracksState } from '../tracks/useManualTracks';
import type { useTripPhotos } from '../photos/useTripPhotos';
import type { usePhotoImportSession } from '../photos/usePhotoImportSession';
import type { ControlPanel } from '../controls/ControlDock';
type Props = {
  photoPlacement: PhotoPlacementJob;
  tracks: ManualTracksState;
  photos: ReturnType<typeof useTripPhotos>;
  setPhotoPlacement: (v: PhotoPlacementJob | null) => void;
  setOutdoorPhotos: (v: boolean) => void;
  setPanel: (p: ControlPanel) => void;
  photoImport: ReturnType<typeof usePhotoImportSession>;
  setPhotoGroup: (ids: string[]) => void;
};
/** Retains the photo import queue while choosing a map point, then returns to the owning workflow. */
export function WorkbenchPhotoPlacement({
  photoPlacement,
  tracks,
  photos,
  setPhotoPlacement,
  setOutdoorPhotos,
  setPanel,
  photoImport,
  setPhotoGroup,
}: Props) {
  return (
    <PhotoPlacement
      job={photoPlacement}
      track={tracks.saved.find((t) => t.id === photoPlacement.trackId)}
      photos={photos}
      onPick={() => setPhotoPlacement({ ...photoPlacement, coordinate: null })}
      onClose={() => {
        const restore = photoPlacement.returnPhotos;
        setPhotoPlacement(null);
        if (restore) {
          setOutdoorPhotos(true);
          setPanel('outdoor');
        }
      }}
      onSaved={(id) => {
        photoImport.setPending((list) =>
          list.filter((p) => p.file !== photoPlacement.file),
        );
        setPhotoPlacement(null);
        photos.setSelected(id);
        setPhotoGroup([id]);
      }}
    />
  );
}
