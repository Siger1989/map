import type { ReactNode } from 'react';
import { ArrowLeft, Share2 } from 'lucide-react';
import type { Coordinate } from '../navigation/types';
import { useRouteDialogFocus } from './useRouteDialogFocus';
import './routeWindows.css';

type DetailEndpoint = { name?: string; coordinate?: Coordinate | null };

function formatCoordinate([longitude, latitude]: Coordinate) {
  return `${Math.abs(latitude).toFixed(5)}°${latitude < 0 ? 'S' : 'N'}，${Math.abs(longitude).toFixed(5)}°${longitude < 0 ? 'W' : 'E'}`;
}

export function RouteBack({ onBack }: { onBack: () => void }) {
  return <button type="button" className="route-back" onClick={onBack}>
    <ArrowLeft size={16} />
    返回
  </button>;
}

export function RouteDetailsDialog({
  name, start, end, endpointActions, profile, onBack, onShare, shareDisabled, open = true, children,
}: {
  name?: string;
  start: DetailEndpoint;
  end: DetailEndpoint;
  endpointActions?: ReactNode;
  profile: ReactNode;
  onBack: () => void;
  onShare: () => void;
  shareDisabled?: boolean;
  open?: boolean;
  children?: ReactNode;
}) {
  const root = useRouteDialogFocus(onBack, undefined, open);
  return <div className="route-window-backdrop" hidden={!open}>
    <section ref={root} className="route-surface route-details" role="dialog" aria-modal="true" aria-label="路线详情">
      <header>
        <RouteBack onBack={onBack} />
        <strong>路线详情</strong>
        <button type="button" className="route-solid" disabled={shareDisabled} onClick={onShare}>
          <Share2 size={16} />
          分享
        </button>
      </header>
      <div className="route-details-body route-details-groups">
        <section className="route-detail-group" aria-label="起终点">
          {name && <h2>{name}</h2>}
          <h3>起终点</h3>
          <dl className="route-data-rows">
            {([['起点', start], ['终点', end]] as const).map(([label, point]) => <div key={label}>
              <dt>{label}</dt>
              <dd>
                {point.name && <span>{point.name}</span>}
                {(point.coordinate || !point.name) && <small className="route-endpoint-value">
                  {point.coordinate ? formatCoordinate(point.coordinate) : '未设置'}
                </small>}
              </dd>
            </div>)}
          </dl>
          {endpointActions && <details className="route-detail-basic-more">
            <summary>起终点操作</summary>
            {endpointActions}
          </details>}
        </section>
        <section className="route-detail-group route-detail-profile-group" aria-label="海拔与统计">
          <h3>海拔与统计</h3>
          {profile}
        </section>
        {children}
      </div>
    </section>
  </div>;
}
