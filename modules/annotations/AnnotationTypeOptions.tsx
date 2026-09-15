import { useState } from 'react';
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
  const [models, setModels] = useState(false);
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
      {!models ? (
        <>
          <button onClick={() => onAdd('pin')}>
            <MapPinPlus size={18} />
            地点标记
          </button>
          <button onClick={() => setModels(true)}>
            <Box size={18} />
            三维模型
          </button>
        </>
      ) : (
        <button onClick={() => setModels(false)}>返回类型</button>
      )}
      {models &&
        (Object.keys(ANNOTATION_CHOICES) as AnnotationChoice[])
          .filter((k) => k !== 'pin')
          .map((kind) => {
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
