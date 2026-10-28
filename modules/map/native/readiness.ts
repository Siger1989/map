import type { NativeProjectionFrame } from './types.ts';

/** A host ACK means the map is initialized; UI readiness also requires a real frame. */
export function shouldNotifyNativeMapReady(
  created: boolean,
  frame: NativeProjectionFrame | null,
  alreadyNotified: boolean,
): boolean {
  return created && frame !== null && !alreadyNotified;
}
