import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import type { VisiblePhoto } from './storage';
import { markerIconElement } from '../annotations/icons';
export class PhotoLayer {
  private photos: VisiblePhoto[] = [];
  private markers: Marker[] = [];
  constructor(
    private map: MapLibreMap,
    private onOpen: (ids: string[]) => void,
  ) {
    map.on('moveend', this.draw);
  }
  sync(photos: VisiblePhoto[]) {
    this.photos = photos;
    this.draw();
  }
  private draw = () => {
    this.markers.forEach((m) => m.remove());
    this.markers = [];
    const groups = new Map<string, VisiblePhoto[]>();
    const { clientWidth: w, clientHeight: h } = this.map.getContainer();
    for (const photo of this.photos) {
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
    for (const group of groups.values()) {
      const button = document.createElement('button');
      button.className = 'trip-photo-marker';
      button.setAttribute(
        'aria-label',
        group.length > 1
          ? `查看 ${group.length} 张行程照片`
          : `查看照片 ${group[0].name}`,
      );
      const img = document.createElement('img');
      img.src = group[0].url;
      img.alt = '';
      button.appendChild(img);
      if (group[0].kind === 'annotation') {
        const markerBadge = document.createElement('i');
        markerBadge.className = 'photo-annotation-badge';
        markerBadge.setAttribute('aria-hidden', 'true');
        markerBadge.style.color = group[0].mapColor ?? '#176b68';
        markerBadge.appendChild(markerIconElement(group[0].mapIcon));
        button.appendChild(markerBadge);
      }
      if (group.length > 1) {
        const badge = document.createElement('span');
        badge.textContent = String(group.length);
        button.appendChild(badge);
      }
      button.addEventListener('pointerdown', (e) => e.stopPropagation());
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onOpen(group.map((p) => p.id));
      });
      this.markers.push(
        new Marker({
          element: button,
          anchor: 'bottom',
          opacity: 1,
          opacityWhenCovered: 1,
        })
          .setLngLat(group[0].coordinates)
          .addTo(this.map),
      );
    }
  };
  dispose() {
    this.map.off('moveend', this.draw);
    this.markers.forEach((m) => m.remove());
    this.markers = [];
  }
}
