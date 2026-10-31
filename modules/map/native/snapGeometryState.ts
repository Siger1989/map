export type SnapGeometryStatus = 'ready' | 'loading' | 'hidden' | 'blocked' | 'missing';

export type SnapGeometryState<T> = {
  status: SnapGeometryStatus;
  lines: T[] | null;
};

/**
 * Keep a ready viewport-local snapshot while same-revision MVT tiles arrive.
 * Any camera/frame revision change or explicit non-loading state invalidates it.
 */
export function nextSnapGeometryState<T>(
  previousRevision: number | null,
  frameRevision: number | null,
  incomingRevision: unknown,
  previous: SnapGeometryState<T> | null,
  incomingStatus: SnapGeometryStatus,
  incomingLines: T[] | null,
): SnapGeometryState<T> {
  const sameCurrentRevision = Number.isSafeInteger(incomingRevision) &&
    incomingRevision === previousRevision && incomingRevision === frameRevision;
  if (
    incomingStatus === 'loading' &&
    sameCurrentRevision &&
    previous?.status === 'ready' &&
    Array.isArray(previous.lines) &&
    previous.lines.length > 0
  ) return previous;

  return {
    status: incomingStatus,
    lines: incomingStatus === 'ready' ? incomingLines : null,
  };
}
