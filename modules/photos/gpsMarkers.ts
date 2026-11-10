import { newAnnotation, type Annotation } from '../annotations/data.ts';
import { coordinate, type Coordinate } from '../navigation/types.ts';
import type { PhotoDraft } from './import.ts';
import type { TripPhoto } from './storage.ts';

const GROUP_RADIUS_METRES = 50;
const MAX_PHOTOS = 200;

type GpsMarkerPlan = {
  annotations: Annotation[];
  photos: TripPhoto[];
  groups: number;
  added: number;
  duplicates: number;
  missingGps: string[];
};

type Anchor = { marker: Annotation; photoId: string; hash: string };

function hashOf(id: string) {
  return id.startsWith('gps-photo:') ? id.slice('gps-photo:'.length) : '';
}

function distanceMetres(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const lat1 = a[1] * rad, lat2 = b[1] * rad;
  const dLat = lat2 - lat1;
  let dLon = (b[0] - a[0]) * rad;
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  if (dLon < -Math.PI) dLon += 2 * Math.PI;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function baseName(name: string) {
  return name.replace(/\.[^.]+$/, '').trim().slice(0, 60) || '照片';
}

/**
 * Plans GPS-photo marker associations without touching storage or device location.
 * Group anchors are actual marker coordinates and are never moved by later photos.
 */
export function planGpsPhotoMarkers(
  drafts: PhotoDraft[],
  annotations: Annotation[],
  existingPhotos: TripPhoto[],
): GpsMarkerPlan {
  const existingIds = new Set(existingPhotos.map((photo) => photo.id));
  const annotationById = new Map(annotations.map((item) => [item.id, item]));
  const occupiedMarkerIds = new Set(annotations.map((item) => item.id));
  const occupiedNames = new Set(annotations.map((item) => item.name));
  const additionalMarkers: Annotation[] = [];
  const photos: TripPhoto[] = [];
  const missingGps: string[] = [];
  const anchors: Anchor[] = [];
  const anchorIds = new Set<string>();

  // Only photo-owned EXIF markers enter the grouping pool. User-created pins remain untouched.
  for (const photo of existingPhotos) {
    if (photo.kind !== 'annotation' || photo.locationSource !== 'exif' || !photo.annotationId) continue;
    const marker = annotationById.get(photo.annotationId);
    if (!marker || !marker.id.startsWith('photo-marker:') || anchorIds.has(marker.id)) continue;
    anchorIds.add(marker.id);
    anchors.push({ marker, photoId: photo.id, hash: hashOf(photo.id) });
  }
  anchors.sort((a, b) => a.hash.localeCompare(b.hash) || a.marker.id.localeCompare(b.marker.id));

  let duplicates = 0;
  const valid = drafts.filter((draft) => coordinate(draft.gpsCoordinates)).slice(0, MAX_PHOTOS)
    .sort((a, b) => a.hash.localeCompare(b.hash) || a.name.localeCompare(b.name));
  for (const draft of drafts) if (!coordinate(draft.gpsCoordinates)) missingGps.push(draft.name);
  let groups = 0;
  const remaining = Math.max(0, MAX_PHOTOS - existingPhotos.length);
  for (const draft of valid) {
    const photoId = `gps-photo:${draft.hash}`;
    if (existingIds.has(photoId)) { duplicates++; continue; }
    if (photos.length >= remaining) break;
    const coordinate = draft.gpsCoordinates!;
    const nearest = anchors.map((anchor) => ({ anchor, distance: distanceMetres(coordinate, anchor.marker.coordinates) }))
      .filter((entry) => entry.distance <= GROUP_RADIUS_METRES)
      .sort((a, b) => a.distance - b.distance || a.anchor.marker.id.localeCompare(b.anchor.marker.id))[0]?.anchor;
    let marker: Annotation;
    if (nearest) {
      marker = nearest.marker;
    } else {
      const markerHash = draft.hash.slice(0, 32);
      let markerId = `photo-marker:${markerHash}`;
      for (let suffix = 1; occupiedMarkerIds.has(markerId); suffix++) markerId = `photo-marker:${markerHash}-${suffix}`;
      occupiedMarkerIds.add(markerId);
      let name = baseName(draft.name);
      if (occupiedNames.has(name)) name = `${name.slice(0, 53)} ${draft.hash.slice(0, 6)}`;
      occupiedNames.add(name);
      marker = { ...newAnnotation('pin', [...coordinate], null, markerId), name };
      additionalMarkers.push(marker);
      anchors.push({ marker, photoId, hash: draft.hash });
      groups++;
    }
    photos.push({
      id: photoId,
      name: draft.name.slice(0, 200),
      trackId: '',
      trackName: '',
      kind: 'annotation',
      annotationId: marker.id,
      time: draft.time ?? 0,
      ...(draft.time === null ? { timeUnknown: true } : { timeSource: 'exif' as const }),
      coordinates: [...coordinate],
      locationSource: 'exif',
      ...(draft.gpsAccuracy !== undefined ? { locationAccuracy: draft.gpsAccuracy } : {}),
      preview: draft.preview,
      detail: draft.detail,
      ...(draft.altitude ? { altitude: draft.altitude } : {}),
    });
    existingIds.add(photoId);
  }
  return {
    annotations: additionalMarkers,
    photos,
    groups,
    added: photos.length,
    duplicates,
    missingGps,
  };
}
