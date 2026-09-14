export type RoutingMode = 'auto' | 'offline' | 'online';
export const ROUTING_MODE_KEY = 'shantu.routing-mode.v1';
export function routingMode(): RoutingMode {
  if (typeof localStorage === 'undefined') return 'auto';
  try {
    const value = localStorage.getItem(ROUTING_MODE_KEY);
    return value === 'offline' || value === 'online' ? value : 'auto';
  } catch {
    return 'auto';
  }
}
export function saveRoutingMode(value: RoutingMode) {
  localStorage.setItem(ROUTING_MODE_KEY, value);
  window.dispatchEvent(new Event('shantu-routing-mode-changed'));
}
