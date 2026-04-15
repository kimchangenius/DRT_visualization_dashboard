import { useMemo } from 'react';
import { nodes, links } from '../data/siouxFallsNetwork';
import type {
  Vehicle,
  Passenger,
  EdgeTraversal,
  NodeActivity,
  VehicleAnalysisSummary,
} from '../types/simulation';

interface NetworkMapProps {
  vehicles: Vehicle[];
  passengers: Passenger[];
  analysisVehicleId?: number | null;
  routeEdges?: [number, number][];
  analysisPassengers?: Passenger[];
  edgeTraversals?: EdgeTraversal[];
  nodeActivity?: NodeActivity[];
  analysisSummary?: VehicleAnalysisSummary;
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

// Heatmap color gradient for traversal count: blue -> yellow -> red
function heatColor(ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  // Gradient stops: 0 -> #60a5fa (blue), 0.5 -> #facc15 (yellow), 1 -> #ef4444 (red)
  const lerp = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);
  if (r < 0.5) {
    const t = r / 0.5;
    return `rgb(${lerp(96, 250, t)}, ${lerp(165, 204, t)}, ${lerp(250, 21, t)})`;
  }
  const t = (r - 0.5) / 0.5;
  return `rgb(${lerp(250, 239, t)}, ${lerp(204, 68, t)}, ${lerp(21, 68, t)})`;
}

// Color by wait-time severity vs threshold (0..1)
function waitSeverityColor(waitTime: number, threshold: number): string {
  if (threshold <= 0) return '#f59e0b';
  const r = Math.max(0, Math.min(1, waitTime / threshold));
  if (r < 0.5) return '#10b981'; // green (safe)
  if (r < 0.85) return '#f59e0b'; // amber (caution)
  return '#ef4444'; // red (exceeded)
}

const ROUTE_TRACE_COLOR = '#a78bfa';
const PICKUP_COLOR = '#f59e0b';
const DROPOFF_COLOR = '#10b981';
const OD_LINE_COLOR = '#94a3b8';

export default function NetworkMap({
  vehicles,
  passengers,
  analysisVehicleId,
  routeEdges,
  analysisPassengers,
  edgeTraversals,
  nodeActivity,
  analysisSummary,
  maxWaitTimeThreshold = 10,
}: NetworkMapProps) {
  const inAnalysis = analysisVehicleId != null;

  const waitingByNode = new Map<number, number>();
  if (!inAnalysis) {
    for (const p of passengers) {
      if (p.status === 'waiting') {
        waitingByNode.set(p.originNodeId, (waitingByNode.get(p.originNodeId) || 0) + 1);
      }
    }
  }

  const movingLinkColors = useMemo(() => buildMovingLinkColors(vehicles), [vehicles]);

  const routeEdgeKeys = useMemo(() => {
    if (!routeEdges) return new Set<string>();
    return new Set(routeEdges.map(([a, b]) => normalizeEdgeKey(a, b)));
  }, [routeEdges]);

  // Map undirected edge key -> {count, dirs: [[a,b], ...]}
  const edgeHeatmap = useMemo(() => {
    const m = new Map<string, { count: number; dirs: [number, number][] }>();
    if (!edgeTraversals) return { map: m, maxCount: 0 };
    let maxCount = 0;
    for (const e of edgeTraversals) {
      const key = normalizeEdgeKey(e.from, e.to);
      const entry = m.get(key) ?? { count: 0, dirs: [] };
      entry.count += e.count;
      entry.dirs.push([e.from, e.to]);
      m.set(key, entry);
      if (entry.count > maxCount) maxCount = entry.count;
    }
    return { map: m, maxCount };
  }, [edgeTraversals]);

  // Node activity lookup
  const nodeActivityById = useMemo(() => {
    const m = new Map<number, NodeActivity>();
    if (!nodeActivity) return m;
    for (const a of nodeActivity) m.set(a.nodeId, a);
    return m;
  }, [nodeActivity]);

  const maxNodeActivity = useMemo(() => {
    if (!nodeActivity || nodeActivity.length === 0) return 0;
    return Math.max(
      ...nodeActivity.map(a => a.pickupCount + a.dropoffCount),
    );
  }, [nodeActivity]);

  // Build passenger pickup/dropoff markers with rich info (passenger list per node)
  type PassengerMarker = {
    x: number;
    y: number;
    nodeId: number;
    type: 'pickup' | 'dropoff';
    passengerIds: number[];
    maxWait: number;
  };
  const passengerMarkers = useMemo<PassengerMarker[]>(() => {
    if (!inAnalysis || !analysisPassengers) return [];
    const pickupByNode = new Map<number, PassengerMarker>();
    const dropoffByNode = new Map<number, PassengerMarker>();
    for (const p of analysisPassengers) {
      const waitTime = p.pickupTime != null ? p.pickupTime - p.requestTime : 0;
      const oNode = nodeById.get(p.originNodeId);
      const dNode = nodeById.get(p.destinationNodeId);
      if (oNode) {
        const existing = pickupByNode.get(p.originNodeId);
        if (existing) {
          existing.passengerIds.push(p.id);
          existing.maxWait = Math.max(existing.maxWait, waitTime);
        } else {
          pickupByNode.set(p.originNodeId, {
            x: oNode.x,
            y: oNode.y,
            nodeId: p.originNodeId,
            type: 'pickup',
            passengerIds: [p.id],
            maxWait: waitTime,
          });
        }
      }
      if (dNode && p.deliveryTime != null) {
        const existing = dropoffByNode.get(p.destinationNodeId);
        if (existing) {
          existing.passengerIds.push(p.id);
        } else {
          dropoffByNode.set(p.destinationNodeId, {
            x: dNode.x,
            y: dNode.y,
            nodeId: p.destinationNodeId,
            type: 'dropoff',
            passengerIds: [p.id],
            maxWait: 0,
          });
        }
      }
    }
    return [...pickupByNode.values(), ...dropoffByNode.values()];
  }, [inAnalysis, analysisPassengers]);

  // OD pair lines for every served passenger (pickup -> dropoff)
  const odLines = useMemo(() => {
    if (!inAnalysis || !analysisPassengers) return [];
    const lines: { x1: number; y1: number; x2: number; y2: number; id: number }[] = [];
    for (const p of analysisPassengers) {
      const o = nodeById.get(p.originNodeId);
      const d = nodeById.get(p.destinationNodeId);
      if (!o || !d) continue;
      lines.push({ x1: o.x, y1: o.y, x2: d.x, y2: d.y, id: p.id });
    }
    return lines;
  }, [inAnalysis, analysisPassengers]);

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
            <marker
              id="arrow-heat-high"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
            </marker>
          </defs>

          {/* Base links */}
          {links.filter((_, i) => i % 2 === 0).map(link => {
            const from = nodeById.get(link.from);
            const to = nodeById.get(link.to);
            if (!from || !to) return null;
            const edgeKey = normalizeEdgeKey(link.from, link.to);

            if (inAnalysis) {
              const heat = edgeHeatmap.map.get(edgeKey);
              const isOnRoute = routeEdgeKeys.has(edgeKey);
              const ratio =
                heat && edgeHeatmap.maxCount > 0 ? heat.count / edgeHeatmap.maxCount : 0;
              const stroke = heat ? heatColor(ratio) : '#374151';
              const width = heat ? 1.2 + ratio * 3.2 : 0.6;
              const opacity = heat ? 0.9 : 0.25;
              return (
                <line
                  key={`link-${link.id}`}
                  x1={from.x} y1={from.y}
                  x2={to.x} y2={to.y}
                  stroke={isOnRoute && !heat ? ROUTE_TRACE_COLOR : stroke}
                  strokeWidth={width}
                  strokeOpacity={opacity}
                />
              );
            }

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
            // Midpoint slightly toward "to" so marker is visible
            const mx = from.x + (to.x - from.x) * 0.55;
            const my = from.y + (to.y - from.y) * 0.55;
            const ratio = edgeHeatmap.maxCount > 0 ? e.count / edgeHeatmap.maxCount : 0;
            const arrowId = ratio > 0.66 ? 'arrow-heat-high' : 'arrow-route';
            return (
              <line
                key={`arrow-${idx}`}
                x1={from.x + (to.x - from.x) * 0.45}
                y1={from.y + (to.y - from.y) * 0.45}
                x2={mx}
                y2={my}
                stroke="transparent"
                strokeWidth={0.1}
                markerEnd={`url(#${arrowId})`}
              />
            );
          })}

          {/* OD pair connection lines (dashed, behind markers) */}
          {inAnalysis && odLines.map(l => (
            <line
              key={`od-${l.id}`}
              x1={l.x1} y1={l.y1}
              x2={l.x2} y2={l.y2}
              stroke={OD_LINE_COLOR}
              strokeWidth={0.4}
              strokeOpacity={0.4}
              strokeDasharray="2 2"
            />
          ))}

          {/* Nodes */}
          {nodes.map(node => {
            const wCount = waitingByNode.get(node.id) || 0;
            const activity = nodeActivityById.get(node.id);
            const activityTotal = activity
              ? activity.pickupCount + activity.dropoffCount
              : 0;
            const activityRatio =
              maxNodeActivity > 0 ? activityTotal / maxNodeActivity : 0;
            const activityRing = inAnalysis && activityTotal > 0;
            return (
              <g key={`node-${node.id}`}>
                {wCount > 0 && (
                  <circle
                    cx={node.x} cy={node.y}
                    r={8 + wCount * 2}
                    fill="#f59e0b"
                    fillOpacity={0.15}
                  />
                )}
                {activityRing && (
                  <circle
                    cx={node.x} cy={node.y}
                    r={7 + activityRatio * 6}
                    fill="none"
                    stroke="#a78bfa"
                    strokeOpacity={0.35 + activityRatio * 0.35}
                    strokeWidth={0.8}
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
                {wCount > 0 && (
                  <text
                    x={node.x + 8} y={node.y - 6}
                    fill="#f59e0b" fontSize={5} fontWeight="bold"
                  >
                    {wCount}
                  </text>
                )}
                {activityRing && (
                  <text
                    x={node.x + 7} y={node.y + 9}
                    fill="#c4b5fd" fontSize={3.8} fontWeight="bold"
                  >
                    ↑{activity!.pickupCount}↓{activity!.dropoffCount}
                  </text>
                )}
              </g>
            );
          })}

          {/* Passenger markers (analysis) with IDs & wait severity */}
          {inAnalysis && passengerMarkers.map(m => {
            const size = 4;
            const count = m.passengerIds.length;
            const idsLabel =
              count <= 2
                ? m.passengerIds.map(id => `P${id}`).join(',')
                : `P${m.passengerIds[0]}+${count - 1}`;
            if (m.type === 'pickup') {
              const color = waitSeverityColor(m.maxWait, maxWaitTimeThreshold);
              return (
                <g key={`pm-pickup-${m.nodeId}`}>
                  <polygon
                    points={`${m.x - 6},${m.y - size - 3} ${m.x + 6},${m.y - size - 3} ${m.x},${m.y - 1}`}
                    fill={color}
                    fillOpacity={0.85}
                    stroke="#fff"
                    strokeWidth={0.3}
                  />
                  <text
                    x={m.x} y={m.y - size - 5}
                    textAnchor="middle" fill={color}
                    fontSize={3.8} fontWeight="bold"
                  >
                    {idsLabel}
                  </text>
                </g>
              );
            }
            return (
              <g key={`pm-dropoff-${m.nodeId}`}>
                <polygon
                  points={`${m.x - 6},${m.y + size + 3} ${m.x + 6},${m.y + size + 3} ${m.x},${m.y + 1}`}
                  fill={DROPOFF_COLOR}
                  fillOpacity={0.85}
                  stroke="#fff"
                  strokeWidth={0.3}
                />
                <text
                  x={m.x} y={m.y + size + 8}
                  textAnchor="middle" fill={DROPOFF_COLOR}
                  fontSize={3.8} fontWeight="bold"
                >
                  {idsLabel}
                </text>
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

        {inAnalysis && analysisSummary && (
          <div className="analysis-overlay">
            <div className="analysis-overlay-title">Vehicle V{analysisVehicleId} Summary</div>
            <div className="analysis-overlay-grid">
              <div className="stat-item">
                <span className="stat-label">Served</span>
                <span className="stat-value">{analysisSummary.servedPassengers}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Trips</span>
                <span className="stat-value">{analysisSummary.totalTrips}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Distance</span>
                <span className="stat-value">{analysisSummary.totalDistance.toFixed(1)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Avg Wait</span>
                <span className="stat-value">{analysisSummary.avgWaitTime.toFixed(1)}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Max Wait</span>
                <span
                  className="stat-value"
                  style={{
                    color: waitSeverityColor(analysisSummary.maxWaitTime, maxWaitTimeThreshold),
                  }}
                >
                  {analysisSummary.maxWaitTime.toFixed(1)}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Avg Detour</span>
                <span className="stat-value">×{analysisSummary.avgDetourFactor.toFixed(2)}</span>
              </div>
              <div className="stat-item stat-item-wide">
                <span className="stat-label">Status Share</span>
                <div className="stat-bar">
                  <div
                    className="stat-bar-seg"
                    style={{
                      width: `${analysisSummary.idlePct}%`,
                      background: '#3b82f6',
                    }}
                    title={`Idle ${analysisSummary.idlePct}%`}
                  />
                  <div
                    className="stat-bar-seg"
                    style={{
                      width: `${analysisSummary.pickupPct}%`,
                      background: '#f59e0b',
                    }}
                    title={`Pickup ${analysisSummary.pickupPct}%`}
                  />
                  <div
                    className="stat-bar-seg"
                    style={{
                      width: `${analysisSummary.carryingPct}%`,
                      background: '#10b981',
                    }}
                    title={`Carrying ${analysisSummary.carryingPct}%`}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="map-legend">
          {inAnalysis ? (
            <>
              <div className="legend-item">
                <span className="legend-bar" style={{
                  background: 'linear-gradient(to right, #60a5fa, #facc15, #ef4444)',
                }} />
                Link usage (low → high)
              </div>
              <div className="legend-item">
                <span className="legend-triangle-up" style={{ borderBottomColor: PICKUP_COLOR }} /> Pickup
              </div>
              <div className="legend-item">
                <span className="legend-triangle-down" style={{ borderTopColor: DROPOFF_COLOR }} /> Dropoff
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#ef4444' }} /> Wait exceeded
              </div>
              <div className="legend-item">
                <span
                  className="legend-dot"
                  style={{ background: 'transparent', border: `1px solid ${ROUTE_TRACE_COLOR}` }}
                /> Activity ring
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
