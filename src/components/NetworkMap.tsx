import { useMemo } from 'react';
import { nodes, links } from '../data/siouxFallsNetwork';
import type { Vehicle, Passenger } from '../types/simulation';

interface NetworkMapProps {
  vehicles: Vehicle[];
  passengers: Passenger[];
}

const PADDING = 10;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;

const nodeById = new Map(nodes.map(n => [n.id, n]));

/** Undirected adjacency for edge-following vehicle motion (matches drawn links). */
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

/** Undirected edge key → 차량 상태색 목록 (이동 경로상 링크마다 1회) */
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

export default function NetworkMap({ vehicles, passengers }: NetworkMapProps) {
  const waitingByNode = new Map<number, number>();
  for (const p of passengers) {
    if (p.status === 'waiting') {
      waitingByNode.set(p.originNodeId, (waitingByNode.get(p.originNodeId) || 0) + 1);
    }
  }

  const movingLinkColors = useMemo(() => buildMovingLinkColors(vehicles), [vehicles]);

  return (
    <div className="panel network-panel">
      <h3 className="panel-title">Sioux Falls Network</h3>
      <div className="network-map-container">
        <svg
          viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
          preserveAspectRatio="xMidYMid meet"
          className="network-svg"
        >
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

          {nodes.map(node => {
            const wCount = waitingByNode.get(node.id) || 0;
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
              </g>
            );
          })}

          {vehicles.map(v => {
            const pos = getVehiclePosition(v);
            return (
              <g key={`vehicle-${v.id}`}>
                <circle
                  cx={pos.x} cy={pos.y} r={4}
                  fill={vehicleColor(v.status)}
                  stroke="#fff" strokeWidth={1.2}
                >
                  <animate
                    attributeName="r"
                    values="4;5;4"
                    dur="1.5s"
                    repeatCount="indefinite"
                  />
                </circle>
                <text
                  x={pos.x} y={pos.y - 7}
                  textAnchor="middle" fill="#fff"
                  fontSize={5} fontWeight="bold"
                >
                  V{v.id}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="map-legend">
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
        </div>
      </div>
    </div>
  );
}
