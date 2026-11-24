import type { ReactNode } from 'react';
import './routeActionGroups.css';

export function RouteActionGroups({ primary, context, important, utilities, appearance }: {
  primary: ReactNode;
  context?: ReactNode;
  important?: ReactNode;
  utilities?: ReactNode;
  appearance?: ReactNode;
}) {
  return <nav className="route-action-groups" aria-label="路线操作">
    <div className="route-action-groups__main" data-action-group="main">{primary}{context}</div>
    {important && <div className="route-action-groups__row" data-action-group="important">{important}</div>}
    {utilities && <div className="route-action-groups__row" data-action-group="utilities">{utilities}</div>}
    {appearance && <div className="route-action-groups__appearance">{appearance}</div>}
  </nav>;
}
