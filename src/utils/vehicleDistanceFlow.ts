import type { ReplayVehicleMovement } from '../types/simulation';
import { normalizeEdgeKey } from './networkGeometry';

export type VehicleDistanceFlowStatus = 'picking_up' | 'carrying';

export interface VehicleDistanceDirection {
  fromNodeId: number;
  toNodeId: number;
  status: VehicleDistanceFlowStatus;
  distance: number;
  movementCount: number;
}

export interface VehicleDistanceFlowEdge {
  key: string;
  fromNodeId: number;
  toNodeId: number;
  statusDistances: Record<VehicleDistanceFlowStatus, number>;
  statusMovementCounts: Record<VehicleDistanceFlowStatus, number>;
  statusVehicleIds: Record<VehicleDistanceFlowStatus, Set<number>>;
  statusRequestIds: Record<VehicleDistanceFlowStatus, Set<number>>;
  directions: VehicleDistanceDirection[];
}

export interface VehicleDistanceFlow {
  edges: VehicleDistanceFlowEdge[];
  statusDistances: Record<VehicleDistanceFlowStatus, number>;
  totalDistance: number;
}

type MutableDirection = VehicleDistanceDirection;

interface MutableDistanceFlowEdge extends Omit<VehicleDistanceFlowEdge, 'directions'> {
  directionMap: Map<string, MutableDirection>;
}

function emptyStatusValues(): Record<VehicleDistanceFlowStatus, number> {
  return {
    picking_up: 0,
    carrying: 0,
  };
}

function emptyStatusSets(): Record<VehicleDistanceFlowStatus, Set<number>> {
  return {
    picking_up: new Set<number>(),
    carrying: new Set<number>(),
  };
}

function movementStatus(
  movement: ReplayVehicleMovement,
): VehicleDistanceFlowStatus {
  return movement.movementType === 'pickup' ? 'picking_up' : 'carrying';
}

function intervalDistance(
  edgeStartTime: number,
  travelTime: number,
  edgeDistance: number,
  distanceTravelled: number,
  rangeStart: number,
  rangeEnd: number,
): number {
  if (distanceTravelled <= 0 || travelTime <= 0 || edgeDistance <= 0) return 0;

  const travelledFraction = Math.min(1, distanceTravelled / edgeDistance);
  const travelledEndTime = edgeStartTime + travelTime * travelledFraction;
  const overlapStart = Math.max(edgeStartTime, rangeStart);
  const overlapEnd = Math.min(travelledEndTime, rangeEnd);
  if (overlapEnd <= overlapStart) return 0;

  return Math.min(
    distanceTravelled,
    (edgeDistance / travelTime) * (overlapEnd - overlapStart),
  );
}

export function buildVehicleDistanceFlow(
  movements: ReplayVehicleMovement[],
  rangeStart: number,
  rangeEnd: number,
  focusVehicleId: number | null = null,
): VehicleDistanceFlow {
  const edgeMap = new Map<string, MutableDistanceFlowEdge>();
  const statusDistances = emptyStatusValues();

  if (rangeEnd <= rangeStart) {
    return { edges: [], statusDistances, totalDistance: 0 };
  }

  for (const movement of movements) {
    if (focusVehicleId != null && movement.vehicleId !== focusVehicleId) continue;
    if (movement.startTime >= rangeEnd || movement.endTime <= rangeStart) continue;

    const status = movementStatus(movement);
    let edgeStartTime = movement.startTime;

    for (const edge of movement.edges) {
      const distance = intervalDistance(
        edgeStartTime,
        edge.travelTime,
        edge.distance,
        edge.distanceTravelled,
        rangeStart,
        rangeEnd,
      );
      edgeStartTime += edge.travelTime;
      if (distance <= 0) continue;

      const key = normalizeEdgeKey(edge.fromNodeId, edge.toNodeId);
      const existing = edgeMap.get(key);
      const flowEdge = existing ?? {
        key,
        fromNodeId: Math.min(edge.fromNodeId, edge.toNodeId),
        toNodeId: Math.max(edge.fromNodeId, edge.toNodeId),
        statusDistances: emptyStatusValues(),
        statusMovementCounts: emptyStatusValues(),
        statusVehicleIds: emptyStatusSets(),
        statusRequestIds: emptyStatusSets(),
        directionMap: new Map<string, MutableDirection>(),
      };

      flowEdge.statusDistances[status] += distance;
      flowEdge.statusMovementCounts[status] += 1;
      flowEdge.statusVehicleIds[status].add(movement.vehicleId);
      flowEdge.statusRequestIds[status].add(movement.requestId);

      const directionKey = `${status}:${edge.fromNodeId}->${edge.toNodeId}`;
      const direction = flowEdge.directionMap.get(directionKey) ?? {
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        status,
        distance: 0,
        movementCount: 0,
      };
      direction.distance += distance;
      direction.movementCount += 1;
      flowEdge.directionMap.set(directionKey, direction);

      edgeMap.set(key, flowEdge);
      statusDistances[status] += distance;
    }
  }

  const edges = [...edgeMap.values()]
    .map(({ directionMap, ...edge }) => ({
      ...edge,
      directions: [...directionMap.values()].sort(
        (left, right) =>
          left.status.localeCompare(right.status) ||
          left.fromNodeId - right.fromNodeId ||
          left.toNodeId - right.toNodeId,
      ),
    }))
    .sort(
      (left, right) =>
        right.statusDistances.picking_up +
          right.statusDistances.carrying -
          left.statusDistances.picking_up -
          left.statusDistances.carrying ||
        left.fromNodeId - right.fromNodeId ||
        left.toNodeId - right.toNodeId,
    );

  return {
    edges,
    statusDistances,
    totalDistance: statusDistances.picking_up + statusDistances.carrying,
  };
}
