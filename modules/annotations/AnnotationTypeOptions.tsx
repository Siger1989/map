import {
  MapPinPlus,
  Box,
  Cylinder,
  Circle,
  Shapes,
  ArrowDownToLine,
} from 'lucide-react';
import { ANNOTATION_CHOICES, type AnnotationChoice } from './data';

/** Shared by map, route and section pickers. Creation target is supplied by the caller. */
export function AnnotationTypeOptions({
  onAdd,
  onOutline,
}: {
  onAdd: (kind: AnnotationChoice) => void;
  onOutline?: () => void;
}) {
  const icons = {
    pin: MapPinPlus,
    box: Box,
    cylinder: Cylinder,
    sphere: Circle,
    prism: Shapes,
    borehole: ArrowDownToLine,
  };
  return (
    <>
      {(Object.keys(ANNOTATION_CHOICES) as AnnotationChoice[]).map((kind) => {
        const Icon = icons[kind];
        return (
          <button
            key={kind}
            onClick={() =>
              kind === 'prism' && onOutline ? onOutline() : onAdd(kind)
            }
          >
            <Icon size={18} />
            {ANNOTATION_CHOICES[kind]}
          </button>
        );
      })}
    </>
  );
}
