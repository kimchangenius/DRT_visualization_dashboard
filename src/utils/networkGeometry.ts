import { links, nodeMap } from '../data/siouxFallsNetwork';
import type { Vehicle } from '../types/simulation';

export interface NetworkPoint {
  x: number;
  y: number;
}

const adjacency = new Map<number, Set<number>>();
for (const link of links) {
  if (!adjacency.has(link.from)) adjacency.set(link.from, new Set());
  if (!adjacency.has(link.to)) adjacency.set(link.to, new Set());
  adjacency.get(link.from)!.add(link.to);
  adjacency.get(link.to)!.add(link.from);
}

const shortestPathCache = new Map<string, number[] | null>();

export function shortestPathOnGraph(from: number, to: number): number[] | null {
  if (!nodeMap.has(from) || !nodeMap.has(to)) return null;
  if (from === to) return [from];

  const cacheKey = `${from}-${to}`;
  const cached = shortestPathCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const queue: number[][] = [[from]];
  const visited = new Set<number>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      if (next === to) {
        const result = [...path, next];
        shortestPathCache.set(cacheKey, result);
        shortestPathCache.set(`${to}-${from}`, [...result].reverse());
        return result;
      }
      visited.add(next);
      queue.push([...path, next]);
    }
  }
  shortestPathCache.set(cacheKey, null);
  return null;
}

export function pointAlongNetworkPath(
  nodeIds: number[],
  progress: number,
): NetworkPoint | null {
  if (nodeIds.length === 0) return null;
  if (nodeIds.length === 1) {
    const node = nodeMap.get(nodeIds[0]);
    return node ? { x: node.x, y: node.y } : null;
  }

  const clampedProgress = Math.min(1, Math.max(0, progress));
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 0; index < nodeIds.length - 1; index += 1) {
    const from = nodeMap.get(nodeIds[index]);
    const to = nodeMap.get(nodeIds[index + 1]);
    if (!from || !to) return null;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    segmentLengths.push(length);
    totalLength += length;
  }

  if (totalLength <= 0) {
    const node = nodeMap.get(nodeIds[0]);
    return node ? { x: node.x, y: node.y } : null;
  }

  let remaining = clampedProgress * totalLength;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const length = segmentLengths[index];
    const from = nodeMap.get(nodeIds[index])!;
    const to = nodeMap.get(nodeIds[index + 1])!;
    if (remaining <= length) {
      const ratio = length > 0 ? remaining / length : 0;
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      };
    }
    remaining -= length;
  }

  const last = nodeMap.get(nodeIds[nodeIds.length - 1]);
  return last ? { x: last.x, y: last.y } : null;
}

export function routeNodeIdsForVehicle(vehicle: Vehicle): number[] {
  if (vehicle.path.length >= 2) {
    if (vehicle.currentEdgeIndex !== undefined || vehicle.path.length > 2) {
      return vehicle.path;
    }
    return shortestPathOnGraph(vehicle.path[0], vehicle.path[1]) ?? vehicle.path;
  }

  if (vehicle.targetNodeId != null) {
    return shortestPathOnGraph(vehicle.currentNodeId, vehicle.targetNodeId) ?? [
      vehicle.currentNodeId,
      vehicle.targetNodeId,
    ];
  }

  return [vehicle.currentNodeId];
}

export function vehiclePosition(vehicle: Vehicle): NetworkPoint {
  if (vehicle.path.length >= 2) {
    const edgeIndex = vehicle.currentEdgeIndex;
    if (
      edgeIndex != null &&
      Number.isInteger(edgeIndex) &&
      edgeIndex >= 0 &&
      edgeIndex < vehicle.path.length - 1
    ) {
      const from = nodeMap.get(vehicle.path[edgeIndex]);
      const to = nodeMap.get(vehicle.path[edgeIndex + 1]);
      if (from && to) {
        const edgeProgress = Math.min(
          1,
          Math.max(0, vehicle.currentEdgeProgress ?? 0),
        );
        return {
          x: from.x + (to.x - from.x) * edgeProgress,
          y: from.y + (to.y - from.y) * edgeProgress,
        };
      }
    }
    const position = pointAlongNetworkPath(
      routeNodeIdsForVehicle(vehicle),
      vehicle.pathProgress,
    );
    if (position) return position;
  }

  const node = nodeMap.get(vehicle.currentNodeId);
  return node ? { x: node.x, y: node.y } : { x: 0, y: 0 };
}

export function normalizeEdgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function areNetworkNeighbors(a: number, b: number): boolean {
  return adjacency.get(a)?.has(b) ?? false;
}
