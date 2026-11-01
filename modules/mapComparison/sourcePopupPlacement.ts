export type SourcePopupPlacement = {
  side: 'above' | 'below';
  maxHeight: number;
};

/** Place the complete source menu in the side of the current visible viewport with room. */
export function sourcePopupPlacement(input: {
  triggerTop: number;
  triggerBottom: number;
  safeTop: number;
  safeBottom: number;
  contentHeight: number;
  preferredMaxHeight: number;
  gap?: number;
}): SourcePopupPlacement {
  const gap = Math.max(0, input.gap ?? 2);
  const above = Math.max(0, input.triggerTop - input.safeTop - gap);
  const below = Math.max(0, input.safeBottom - input.triggerBottom - gap);
  const desired = Math.min(Math.max(0, input.contentHeight), Math.max(0, input.preferredMaxHeight));
  const side = below >= desired || (below >= above && above < desired)
    ? 'below'
    : above >= desired || above > below
      ? 'above'
      : 'below';
  return { side, maxHeight: Math.max(0, Math.min(input.preferredMaxHeight, side === 'above' ? above : below)) };
}
