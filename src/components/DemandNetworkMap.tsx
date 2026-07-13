import { useMemo } from 'react';
import { links, nodeMap, nodes } from '../data/siouxFallsNetwork';
import type { Passenger } from '../types/simulation';

interface DemandNetworkMapProps {
  passengers: Passenger[];
  replayTime: number;
  comparisonPassengers?: Passenger[];
  comparisonReplayTime?: number;
  title?: string;
  embedded?: boolean;
  hideTitle?: boolean;
}

interface NodeDemand {
  nodeId: number;
  total: number;
  accepted: number;
  cancelled: number;
  pending: number;
}

const PADDING = 22;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;
// Paul Tol's color-blind-safe, grayscale-compatible high-contrast palette.
const ACCEPT_COLOR = '#004488';
const PENDING_COLOR = '#ddaa33';
const CANCELLED_COLOR = '#bb5566';

function buildNodeDemand(passengers: Passenger[], replayTime: number): NodeDemand[] {
  const demandByNode = new Map<number, NodeDemand>();
  for (const passenger of passengers) {
    if (passenger.requestTime > replayTime || !nodeMap.has(passenger.originNodeId)) continue;
    const demand = demandByNode.get(passenger.originNodeId) ?? {
      nodeId: passenger.originNodeId,
      total: 0,
      accepted: 0,
      cancelled: 0,
      pending: 0,
    };
    demand.total += 1;
    if (passenger.status === 'cancelled') demand.cancelled += 1;
    else if (passenger.assignedVehicleId != null) demand.accepted += 1;
    else demand.pending += 1;
    demandByNode.set(passenger.originNodeId, demand);
  }
  return [...demandByNode.values()];
}

function demandRadius(total: number, sharedMaximum: number): number {
  if (total <= 0 || sharedMaximum <= 0) return 4.5;
  return Math.max(7, 15 * Math.sqrt(total / sharedMaximum));
}

function sectorPath(
  cx: number,
  cy: number,
  radius: number,
  startRatio: number,
  endRatio: number,
): string | null {
  const span = endRatio - startRatio;
  if (span <= 0) return null;
  if (span >= 0.999999) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.001} ${cy - radius} Z`;
  }
  const startAngle = startRatio * Math.PI * 2 - Math.PI / 2;
  const endAngle = endRatio * Math.PI * 2 - Math.PI / 2;
  const startX = cx + Math.cos(startAngle) * radius;
  const startY = cy + Math.sin(startAngle) * radius;
  const endX = cx + Math.cos(endAngle) * radius;
  const endY = cy + Math.sin(endAngle) * radius;
  return [
    `M ${cx} ${cy}`,
    `L ${startX} ${startY}`,
    `A ${radius} ${radius} 0 ${span > 0.5 ? 1 : 0} 1 ${endX} ${endY}`,
    'Z',
  ].join(' ');
}

export default function DemandNetworkMap({
  passengers,
  replayTime,
  comparisonPassengers,
  comparisonReplayTime,
  title = 'Demand Network Map',
  embedded = false,
  hideTitle = false,
}: DemandNetworkMapProps) {
  const demand = useMemo(
    () => buildNodeDemand(passengers, replayTime),
    [passengers, replayTime],
  );
  const comparisonDemand = useMemo(
    () => comparisonPassengers && comparisonReplayTime != null
      ? buildNodeDemand(comparisonPassengers, comparisonReplayTime)
      : [],
    [comparisonPassengers, comparisonReplayTime],
  );
  const demandByNode = useMemo(
    () => new Map(demand.map(nodeDemand => [nodeDemand.nodeId, nodeDemand])),
    [demand],
  );
  const sharedMaximum = Math.max(
    0,
    ...demand.map(nodeDemand => nodeDemand.total),
    ...comparisonDemand.map(nodeDemand => nodeDemand.total),
  );
  const totals = demand.reduce(
    (sum, nodeDemand) => ({
      total: sum.total + nodeDemand.total,
      accepted: sum.accepted + nodeDemand.accepted,
      cancelled: sum.cancelled + nodeDemand.cancelled,
      pending: sum.pending + nodeDemand.pending,
    }),
    { total: 0, accepted: 0, cancelled: 0, pending: 0 },
  );
  const panelClassName = embedded
    ? 'demand-network-panel demand-network-panel-embedded'
    : 'panel chart-panel demand-network-panel';

  return (
    <div className={panelClassName}>
      {!hideTitle ? <h3 className="panel-title">{title}</h3> : null}
      <div className="demand-network-container">
        <div className="demand-network-svg-wrap">
          <svg
            viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
            preserveAspectRatio="xMidYMid meet"
            className="demand-network-svg"
            aria-label={`${title} at t=${replayTime}`}
          >
            {links.filter((_, index) => index % 2 === 0).map(link => {
              const from = nodeMap.get(link.from);
              const to = nodeMap.get(link.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`demand-link-${link.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="demand-network-link"
                />
              );
            })}
            {nodes.map(node => {
              const nodeDemand = demandByNode.get(node.id);
              const total = nodeDemand?.total ?? 0;
              const radius = demandRadius(total, sharedMaximum);
              const acceptedRatio = total > 0 ? (nodeDemand?.accepted ?? 0) / total : 0;
              const cancelledRatio = total > 0 ? (nodeDemand?.cancelled ?? 0) / total : 0;
              const acceptedPath = sectorPath(node.x, node.y, radius, 0, acceptedRatio);
              const cancelledPath = sectorPath(
                node.x,
                node.y,
                radius,
                acceptedRatio,
                acceptedRatio + cancelledRatio,
              );
              return (
                <g key={`demand-node-${node.id}`} className="demand-network-node">
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius}
                    fill={total > 0 ? PENDING_COLOR : '#1e293b'}
                    stroke={total > 0 ? '#f8fafc' : '#64748b'}
                    strokeWidth={total > 0 ? 0.9 : 0.7}
                  >
                    <title>
                      {`N${node.id}: ${total} requests · Accepted ${nodeDemand?.accepted ?? 0} · Pending ${nodeDemand?.pending ?? 0} · Cancelled ${nodeDemand?.cancelled ?? 0}`}
                    </title>
                  </circle>
                  {acceptedPath ? <path d={acceptedPath} fill={ACCEPT_COLOR} pointerEvents="none" /> : null}
                  {cancelledPath ? <path d={cancelledPath} fill={CANCELLED_COLOR} pointerEvents="none" /> : null}
                  <text
                    x={node.x}
                    y={node.y + 0.4}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className="demand-network-node-label"
                  >
                    {node.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="demand-network-footer">
          <div className="demand-network-totals">
            <span>Requests {totals.total}</span>
            <span>Accepted {totals.accepted}</span>
            <span>Pending {totals.pending}</span>
            <span>Cancelled {totals.cancelled}</span>
          </div>
          <div className="demand-network-legend" aria-label="Demand outcome legend">
            <span><i style={{ background: ACCEPT_COLOR }} />Accepted</span>
            <span><i style={{ background: PENDING_COLOR }} />Pending</span>
            <span><i style={{ background: CANCELLED_COLOR }} />Cancelled</span>
          </div>
        </div>
      </div>
    </div>
  );
}
