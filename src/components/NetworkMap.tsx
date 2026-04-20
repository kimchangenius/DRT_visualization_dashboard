import { useMemo } from 'react';
import { nodes, links } from '../data/siouxFallsNetwork';
import type {
  Vehicle,
  Passenger,
  EdgeTraversal,
  // NodeActivity,  // Activity ring – disabled
} from '../types/simulation';

interface NetworkMapProps {
  vehicles: Vehicle[];
  passengers: Passenger[];
  analysisVehicleId?: number | null;
  edgeTraversals?: EdgeTraversal[];
  // nodeActivity?: NodeActivity[];  // Activity ring – disabled
  maxWaitTimeThreshold?: number;
}

const PADDING = 10;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;

const nodeById = new Map(nodes.map(n => [n.id, n]));

const adjacency = new Map<number, Set<number>>();
for (const l of links) {
  if (!adjacency.has(l.from)) adjacency.set(l.from, new Set());
  if (!adjacency.has(l.to)) adjacency.set(l.to, new Set());
  adjacency.get(l.from)!.add(l.to);
  adjacency.get(l.to)!.add(l.from);
}

function shortestPathOnGraph(from: number, to: number): number[] | null {
  if (from === to) return [from];
  const queue: number[][] = [[from]];
  const visited = new Set<number>([from]);
  while (queue.length) {
    const path = queue.shift()!;
    const u = path[path.length - 1];
    for (const v of adjacency.get(u) ?? []) {
      if (visited.has(v)) continue;
      if (v === to) return [...path, v];
      visited.add(v);
      queue.push([...path, v]);
    }
  }
  return null;
}

function pointAlongPolyline(nodeIds: number[], t: number): { x: number; y: number } | null {
  if (nodeIds.length === 0) return null;
  if (nodeIds.length === 1) {
    const n = nodeById.get(nodeIds[0]);
    return n ? { x: n.x, y: n.y } : null;
  }
  const clamped = Math.min(1, Math.max(0, t));
  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const a = nodeById.get(nodeIds[i]);
    const b = nodeById.get(nodeIds[i + 1]);
    if (!a || !b) return null;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segLens.push(len);
    total += len;
  }
  if (total <= 0) {
    const n = nodeById.get(nodeIds[0]);
    return n ? { x: n.x, y: n.y } : null;
  }
  let dist = clamped * total;
  for (let i = 0; i < nodeIds.length - 1; i++) {
    const len = segLens[i];
    const a = nodeById.get(nodeIds[i])!;
    const b = nodeById.get(nodeIds[i + 1])!;
    if (dist <= len) {
      const r = len > 0 ? dist / len : 0;
      return {
        x: a.x + (b.x - a.x) * r,
        y: a.y + (b.y - a.y) * r,
      };
    }
    dist -= len;
  }
  const last = nodeById.get(nodeIds[nodeIds.length - 1]);
  return last ? { x: last.x, y: last.y } : null;
}

function vehicleColor(status: string) {
  switch (status) {
    case 'idle': return '#3b82f6';
    case 'picking_up': return '#f59e0b';
    case 'carrying': return '#10b981';
    default: return '#6b7280';
  }
}

function normalizeEdgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function buildMovingLinkColors(vehicles: Vehicle[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const v of vehicles) {
    if (v.status !== 'picking_up' && v.status !== 'carrying') continue;
    if (v.targetNodeId == null) continue;
    const route =
      shortestPathOnGraph(v.currentNodeId, v.targetNodeId) ?? [
        v.currentNodeId,
        v.targetNodeId,
      ];
    if (route.length < 2) continue;
    const col = vehicleColor(v.status);
    for (let i = 0; i < route.length - 1; i++) {
      const key = normalizeEdgeKey(route[i], route[i + 1]);
      const list = map.get(key) ?? [];
      list.push(col);
      map.set(key, list);
    }
  }
  return map;
}

function getVehiclePosition(v: Vehicle) {
  if (v.path.length >= 2) {
    const t = Math.min(1, Math.max(0, v.pathProgress));
    let route: number[];
    if (v.path.length > 2) {
      route = v.path;
    } else {
      const sp = shortestPathOnGraph(v.path[0], v.path[1]);
      route = sp && sp.length >= 2 ? sp : v.path;
    }
    const pos = pointAlongPolyline(route, t);
    if (pos) return pos;
  }

  const node = nodeById.get(v.currentNodeId);
  return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
}

// // Color by wait-time severity vs threshold (0..1) – disabled
// function waitSeverityColor(waitTime: number, threshold: number): string {
//   if (threshold <= 0) return '#f59e0b';
//   const r = Math.max(0, Math.min(1, waitTime / threshold));
//   if (r < 0.5) return '#10b981';
//   if (r < 0.85) return '#f59e0b';
//   return '#ef4444';
// }

const ROUTE_TRACE_COLOR = '#a78bfa';
const PICKUP_COLOR = '#f59e0b';
const DROPOFF_COLOR = '#10b981';
const OD_LINE_COLOR = '#94a3b8';

export default function NetworkMap({
  vehicles,
  passengers,
  analysisVehicleId,
  edgeTraversals,
  // nodeActivity,  // Activity ring – disabled
  maxWaitTimeThreshold = 10,
}: NetworkMapProps) {
  const inAnalysis = analysisVehicleId != null;

  const waitingByNode = new Map<number, number>();
  for (const p of passengers) {
    if (p.status === 'waiting') {
      waitingByNode.set(p.originNodeId, (waitingByNode.get(p.originNodeId) || 0) + 1);
    }
  }

  const movingLinkColors = useMemo(() => {
    if (inAnalysis) {
      const selected = vehicles.filter(v => v.id === analysisVehicleId);
      return buildMovingLinkColors(selected);
    }
    return buildMovingLinkColors(vehicles);
  }, [vehicles, inAnalysis, analysisVehicleId]);

  // // Node activity lookup (Activity ring – disabled)
  // const nodeActivityById = useMemo(() => {
  //   const m = new Map<number, NodeActivity>();
  //   if (!nodeActivity) return m;
  //   for (const a of nodeActivity) m.set(a.nodeId, a);
  //   return m;
  // }, [nodeActivity]);
  //
  // const maxNodeActivity = useMemo(() => {
  //   if (!nodeActivity || nodeActivity.length === 0) return 0;
  //   return Math.max(
  //     ...nodeActivity.map(a => a.pickupCount + a.dropoffCount),
  //   );
  // }, [nodeActivity]);

  type PerPassengerMarker = {
    id: number;
    status: string;
    ox: number; oy: number;
    dx: number; dy: number;
    originColor: string;
    hasDest: boolean;
    destColor: string;
  };
  const perPassengerMarkers = useMemo<PerPassengerMarker[]>(() => {
    if (!inAnalysis || analysisVehicleId == null) return [];
    const markers: PerPassengerMarker[] = [];
    for (const p of passengers) {
      const isAcceptedByAnalysisVehicle = p.assignedVehicleId === analysisVehicleId;
      const isUnaccepted = p.assignedVehicleId == null;
      if (!isAcceptedByAnalysisVehicle && !isUnaccepted) continue;

      const oNode = nodeById.get(p.originNodeId);
      const dNode = nodeById.get(p.destinationNodeId);
      if (!oNode || !dNode) continue;

      if (p.status === 'waiting') {
        markers.push({
          id: p.id, status: 'waiting',
          ox: oNode.x, oy: oNode.y, dx: dNode.x, dy: dNode.y,
          originColor: PICKUP_COLOR, hasDest: false, destColor: '',
        });
      } else if (p.status === 'picked_up') {
        markers.push({
          id: p.id, status: 'picked_up',
          ox: oNode.x, oy: oNode.y, dx: dNode.x, dy: dNode.y,
          originColor: '#10b981', hasDest: true, destColor: '#10b981',
        });
      } else if (p.status === 'delivered') {
        markers.push({
          id: p.id, status: 'delivered',
          ox: oNode.x, oy: oNode.y, dx: dNode.x, dy: dNode.y,
          originColor: '#10b981', hasDest: true, destColor: '#10b981',
        });
      } else if (p.status === 'cancelled') {
        markers.push({
          id: p.id, status: 'cancelled',
          ox: oNode.x, oy: oNode.y, dx: dNode.x, dy: dNode.y,
          originColor: PICKUP_COLOR, hasDest: true, destColor: '#ef4444',
        });
      }
    }
    return markers;
  }, [inAnalysis, analysisVehicleId, passengers]);

  return (
    <div className="panel network-panel">
      <h3 className="panel-title">
        {inAnalysis ? `Analysis: Vehicle V${analysisVehicleId}` : 'Sioux Falls Network'}
      </h3>
      <div className="network-map-container">
        <svg
          viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="network-svg"
        >
          {/* Arrowhead marker for directional traversal */}
          <defs>
            <marker
              id="arrow-route"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={ROUTE_TRACE_COLOR} />
            </marker>
          </defs>

          {/* Base links */}
          {links.filter((_, i) => i % 2 === 0).map(link => {
            const from = nodeById.get(link.from);
            const to = nodeById.get(link.to);
            if (!from || !to) return null;
            const edgeKey = normalizeEdgeKey(link.from, link.to);

            const colorsOnEdge = movingLinkColors.get(edgeKey);
            const load = colorsOnEdge?.length ?? 0;
            const strokeColor =
              load === 0
                ? '#4b5563'
                : load === 1
                  ? colorsOnEdge![0]
                  : '#ffffff';
            const strokeWidth = load > 0 ? 1.5 + load * 0.8 : 0.8;
            return (
              <line
                key={`link-${link.id}`}
                x1={from.x} y1={from.y}
                x2={to.x} y2={to.y}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity={0.6}
              />
            );
          })}

          {/* Direction arrows on traversed edges (analysis) */}
          {inAnalysis && edgeTraversals && edgeTraversals.map((e, idx) => {
            const from = nodeById.get(e.from);
            const to = nodeById.get(e.to);
            if (!from || !to) return null;
            const mx = from.x + (to.x - from.x) * 0.55;
            const my = from.y + (to.y - from.y) * 0.55;
            return (
              <line
                key={`arrow-${idx}`}
                x1={from.x + (to.x - from.x) * 0.45}
                y1={from.y + (to.y - from.y) * 0.45}
                x2={mx}
                y2={my}
                stroke="transparent"
                strokeWidth={0.1}
                markerEnd="url(#arrow-route)"
              />
            );
          })}

          {/* OD pair connection lines (dashed, behind markers) */}
          {inAnalysis && perPassengerMarkers.map(m => (
            <line
              key={`od-${m.id}`}
              x1={m.ox} y1={m.oy}
              x2={m.dx} y2={m.dy}
              stroke={OD_LINE_COLOR}
              strokeWidth={0.4}
              strokeOpacity={0.4}
              strokeDasharray="2 2"
            />
          ))}

          {/* Nodes */}
          {nodes.map(node => {
            const wCount = waitingByNode.get(node.id) || 0;
            return (
              <g key={`node-${node.id}`}>
                {!inAnalysis && wCount > 0 && (
                  <circle
                    cx={node.x} cy={node.y}
                    r={8 + wCount * 2}
                    fill="#f59e0b"
                    fillOpacity={0.15}
                  />
                )}
                <circle
                  cx={node.x} cy={node.y} r={6}
                  fill="#1e293b" stroke="#64748b" strokeWidth={1}
                />
                <text
                  x={node.x} y={node.y + 0.5}
                  textAnchor="middle" dominantBaseline="middle"
                  fill="#e2e8f0" fontSize={5} fontWeight="bold"
                >
                  {node.label}
                </text>
                {!inAnalysis && wCount > 0 && (
                  <text
                    x={node.x + 8} y={node.y - 6}
                    fill="#f59e0b" fontSize={5} fontWeight="bold"
                  >
                    {wCount}
                  </text>
                )}
              </g>
            );
          })}

          {/* Per-passenger request markers (analysis) */}
          {inAnalysis && perPassengerMarkers.map(m => {
            const s = 4;
            return (
              <g key={`req-${m.id}`}>
                {/* Origin: inverted triangle ▽ above node */}
                <polygon
                  points={`${m.ox - 5},${m.oy - s - 3} ${m.ox + 5},${m.oy - s - 3} ${m.ox},${m.oy - 1}`}
                  fill={m.originColor} fillOpacity={0.85}
                  stroke="#fff" strokeWidth={0.3}
                />
                <text
                  x={m.ox} y={m.oy - s - 5}
                  textAnchor="middle" fill={m.originColor}
                  fontSize={3.5} fontWeight="bold"
                >
                  P{m.id}
                </text>
                {/* Destination: triangle △ below node */}
                {m.hasDest && (
                  <>
                    <polygon
                      points={`${m.dx - 5},${m.dy + s + 1} ${m.dx + 5},${m.dy + s + 1} ${m.dx},${m.dy - s + 3}`}
                      fill={m.destColor} fillOpacity={0.85}
                      stroke="#fff" strokeWidth={0.3}
                    />
                    <text
                      x={m.dx} y={m.dy + s + 5}
                      textAnchor="middle" fill={m.destColor}
                      fontSize={3.5} fontWeight="bold"
                    >
                      D{m.id}
                    </text>
                  </>
                )}
              </g>
            );
          })}

          {/* Vehicles */}
          {vehicles.map(v => {
            const pos = getVehiclePosition(v);
            const hidden = inAnalysis && analysisVehicleId != null && v.id !== analysisVehicleId;
            const dimmed = inAnalysis && analysisVehicleId == null && false; // reserved
            const isAnalysisVehicle = inAnalysis && v.id === analysisVehicleId;
            if (hidden) return null;
            return (
              <g key={`vehicle-${v.id}`} opacity={1}>
                {isAnalysisVehicle && (
                  <circle
                    cx={pos.x} cy={pos.y} r={8}
                    fill="none"
                    stroke="#fff"
                    strokeWidth={0.5}
                    strokeOpacity={0.6}
                  >
                    <animate
                      attributeName="r"
                      values="6;10;6"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="stroke-opacity"
                      values="0.7;0.1;0.7"
                      dur="2s"
                      repeatCount="indefinite"
                    />
                  </circle>
                )}
                <circle
                  cx={pos.x} cy={pos.y} r={isAnalysisVehicle ? 5 : 4}
                  fill={vehicleColor(v.status)}
                  stroke="#fff" strokeWidth={isAnalysisVehicle ? 1.5 : 1.2}
                >
                  {!dimmed && (
                    <animate
                      attributeName="r"
                      values={isAnalysisVehicle ? '5;6.5;5' : '4;5;4'}
                      dur="1.5s"
                      repeatCount="indefinite"
                    />
                  )}
                </circle>
                <text
                  x={pos.x} y={pos.y - 7}
                  textAnchor="middle" fill="#fff"
                  fontSize={isAnalysisVehicle ? 6 : 5}
                  fontWeight="bold"
                >
                  V{v.id}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="map-legend">
          {inAnalysis ? (
            <>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#3b82f6' }} /> Idle
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#f59e0b' }} /> Picking up
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#10b981' }} /> Carrying
              </div>
              <div className="legend-item">
                <span className="legend-triangle-down" style={{ borderTopColor: PICKUP_COLOR }} /> P: Waiting
              </div>
              <div className="legend-item">
                <span className="legend-triangle-down" style={{ borderTopColor: '#10b981' }} /> P: Picked up
              </div>
              <div className="legend-item">
                <span className="legend-triangle-up" style={{ borderBottomColor: '#10b981' }} /> D: Dropoff
              </div>
              <div className="legend-item">
                <span className="legend-triangle-up" style={{ borderBottomColor: '#ef4444' }} /> D: Cancelled
              </div>
              <div className="legend-item">
                <span className="legend-dash" /> OD pair
              </div>
            </>
          ) : (
            <>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#3b82f6' }} /> Idle
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#f59e0b' }} /> Picking up
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#10b981' }} /> Carrying
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#f59e0b', opacity: 0.4 }} /> Waiting Passenger
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
