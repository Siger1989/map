export type ManeuverKind = 'straight' | 'left' | 'right' | 'uturn' | 'arrival' | 'unknown';

/** Map only explicit, common direction words to symbols; unknown text stays generic. */
export function maneuverKind(text: string): ManeuverKind {
  const value = text.trim();
  if (!value) return 'unknown';
  if (/车道/u.test(value)) return 'unknown';
  if (/(到达|抵达|终点)/u.test(value)) return 'arrival';
  if (/(掉头|调头|返向|折返)/u.test(value)) return 'uturn';
  if (/(左转|左拐|向左转|向左拐)/u.test(value)) return 'left';
  if (/(右转|右拐|向右转|向右拐)/u.test(value)) return 'right';
  if (/(直行|沿.*前进|继续沿|保持直行)/u.test(value)) return 'straight';
  return 'unknown';
}
