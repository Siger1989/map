import type { Map as MapLibreMap } from 'maplibre-gl';
import type { VisiblePhoto } from './storage';
import { markerIconElement } from '../annotations/icons';
import { NearbyMarker } from '../map/NearbyMarker';
import { getNearbyMarkerRange, isCoordinateWithinNearbyRange } from '../map/nearbyMarkerRange';
import { photoMapPresentation } from './mapPresentation';
export class PhotoLayer {
  private photos: VisiblePhoto[] = [];
  private markers = new Map<string, {
    marker: NearbyMarker; image: HTMLImageElement; badge: HTMLElement;
    count: HTMLSpanElement; iconKey: string;
  }>();
  private presentationKey = '';
  constructor(
    private map: MapLibreMap,
    private onOpen: (ids: string[]) => void,
  ) {
    map.on('moveend', this.draw);
    map.on('zoom', this.syncScale);
  }
  sync(photos: VisiblePhoto[]) {
    this.photos = photos;
    this.draw();
  }
  private syncScale = () => {
    const presentation = photoMapPresentation(this.map.getZoom());
    const key = `${presentation.mode}:${presentation.scale.toFixed(5)}`;
    if (this.presentationKey === key) return;
    this.presentationKey = key;
    for (const { marker } of this.markers.values()) {
      const element = marker.getElement();
      element.style.setProperty('--photo-scale', String(presentation.scale));
      element.dataset.presentation = presentation.mode;
    }
  };
  private draw = () => {
    const groups = new Map<string, VisiblePhoto[]>();
    const nearbyRange = getNearbyMarkerRange(this.map);
    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    for (const photo of this.photos) {
      if (!isCoordinateWithinNearbyRange(nearbyRange, photo.coordinates)) continue;
      const p = this.map.project(photo.coordinates);
      if (
        !Number.isFinite(p.x) ||
        !Number.isFinite(p.y) ||
        p.x < -50 ||
        p.y < -50 ||
        p.x > w + 50 ||
        p.y > h + 50
      )
        continue;
      const key =
        photo.kind === 'annotation'
          ? `marker:${photo.annotationId}`
          : `grid:${Math.floor(p.x / 60)}/${Math.floor(p.y / 60)}`;
      const group = groups.get(key) ?? [];
      group.push(photo);
      groups.set(key, group);
    }
    const keep = new Set<string>();
    for (const group of groups.values()) {
      const key = group[0].kind === 'annotation' ? `marker:${group[0].annotationId}`
        : JSON.stringify(group.map(p => p.id).sort());
      keep.add(key);
      let entry = this.markers.get(key);
      if (!entry) {
      const button = document.createElement('button');
      button.className = 'trip-photo-marker';
      const img = document.createElement('img');
      const visual = document.createElement('div');
      visual.className = 'trip-photo-marker-visual';
      img.src = group[0].url;
      img.alt = '';
      visual.appendChild(img);
      button.appendChild(visual);
        const markerBadge = document.createElement('i');
        markerBadge.className = 'photo-annotation-badge';
        markerBadge.setAttribute('aria-hidden', 'true');
        visual.appendChild(markerBadge);
        const badge = document.createElement('span');
        visual.appendChild(badge);
      button.addEventListener('pointerdown', (e) => e.stopPropagation());
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onOpen(JSON.parse(button.dataset.photoIds ?? '[]') as string[]);
      });
      const marker = new NearbyMarker({
          element: button,
          anchor: 'bottom',
          opacity: 1,
          opacityWhenCovered: 0,
        })
          .setLngLat(group[0].coordinates)
          .addTo(this.map);
      entry = { marker, image: img, badge: markerBadge, count: badge, iconKey: '' };
      this.markers.set(key, entry);
      }
      const button = entry.marker.getElement();
      button.setAttribute('aria-label', group.length > 1 ? `查看 ${group.length} 张照片` : `查看照片 ${group[0].name}`);
      button.dataset.photoIds = JSON.stringify(group.map(p => p.id));
      if (entry.image.getAttribute('src') !== group[0].url) entry.image.src = group[0].url;
      entry.badge.hidden = group[0].kind !== 'annotation';
      entry.badge.style.color = group[0].mapColor ?? '#176b68';
      const iconKey = group[0].mapIcon ?? 'pin';
      if (entry.iconKey !== iconKey) {
        entry.badge.replaceChildren(markerIconElement(group[0].mapIcon));
        entry.iconKey = iconKey;
      }
      entry.count.hidden = group.length <= 1;
      entry.count.textContent = String(group.length);
      entry.marker.setLngLat(group[0].coordinates);
    }
    for (const [key, entry] of this.markers) {
      if (!keep.has(key)) { entry.marker.remove(); this.markers.delete(key); }
    }
    this.presentationKey = '';
    this.syncScale();
  };
  dispose() {
    this.map.off('moveend', this.draw);
    this.map.off('zoom', this.syncScale);
    this.markers.forEach(({ marker }) => marker.remove());
    this.markers.clear();
  }
}
