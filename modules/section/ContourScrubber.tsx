import { useRef } from 'react';
import type { Contour } from './contours';
import { noteColor, type ProfileNote } from './profileNotes';
import type { SectionSettings } from './types';
import { sliderFraction } from './notePosition';
import { useContourPointDrag, type PointActions } from './useContourPointDrag';
export function ContourScrubber({
  curve,
  settings,
  sampledAt,
  notes,
  fraction,
  onFraction,
  actions,
}: {
  curve: Contour;
  settings: SectionSettings;
  sampledAt: number;
  notes: ProfileNote[];
  fraction: number;
  onFraction: (n: number) => void;
  actions: PointActions;
}) {
  const track = useRef<HTMLDivElement>(null);
  const bind = useContourPointDrag(
    curve,
    settings,
    sampledAt,
    (x) => {
      const box = track.current!.getBoundingClientRect();
      return sliderFraction(x, box.left, box.width);
    },
    actions,
  );
  return (
    <div className="section-scrubber">
      <span>沿交线选点</span>
      <div ref={track} className="section-multi-track">
        <input
          aria-label="沿交线查看点海拔"
          type="range"
          min="0"
          max="1000"
          step="1"
          value={Math.round(fraction * 1000)}
          onChange={(e) => onFraction(Number(e.target.value) / 1000)}
        />
        {notes.map(
          (note, i) =>
            note.curveName === curve.name &&
            note.source === curve.source && (
              <button
                key={note.id}
                className="section-point-handle"
                aria-label={`拖动测点 ${note.name}`}
                title={`${note.name} · 点按选择，拖动调整，双击编辑`}
                style={{
                  left: `${(note.fraction ?? note.point.distance / (curve.length || 1)) * 100}%`,
                  color: noteColor(note, i),
                }}
                {...bind(note)}
              >
                <span>{i + 1}</span>
              </button>
            ),
        )}
      </div>
    </div>
  );
}
