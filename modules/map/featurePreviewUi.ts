import type { FeatureMove } from './FeatureDragBridge';

/** Route geometry follows the map directly; React only needs drag/snap status. */
export function featurePreviewUiPublisher(publish: (move: FeatureMove | null) => void) {
  let previous: FeatureMove | null = null;
  return (move: FeatureMove | null) => {
    const before = previous;
    previous = move;
    if (move?.target.kind === 'track' && before?.target.kind === 'track' &&
        move.target.node.trackId === before.target.node.trackId &&
        move.target.node.coordinate[0] === before.target.node.coordinate[0] &&
        move.target.node.coordinate[1] === before.target.node.coordinate[1] &&
        move.snappedNode?.trackId === before.snappedNode?.trackId &&
        move.snappedNode?.coordinate[0] === before.snappedNode?.coordinate[0] &&
        move.snappedNode?.coordinate[1] === before.snappedNode?.coordinate[1]) return;
    publish(move);
  };
}
