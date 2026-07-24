import type {
  Passenger,
  ReplayPassengerEvent,
  ReplayVehicleMovement,
  SimulationState,
} from '../types/simulation';
import { vehiclePosition, type NetworkPoint } from './networkGeometry';
import { frameAtOrBefore } from './replay';
import { sortPassengerEvents } from './vehicleTemporal';

export type VehicleIntervalPhase = 'picking_up' | 'carrying';

export interface VehicleIntervalRouteSegment {
  id: string;
  sequence: number;
  phase: VehicleIntervalPhase;
  requestId: number;
  fromNodeId: number;
  toNodeId: number;
  startFraction: number;
  endFraction: number;
  startTime: number;
  endTime: number;
  distance: number;
}

export interface VehicleIntervalEventGroup {
  order: number;
  time: number;
  type: 'pickup' | 'dropoff';
  nodeId: number;
  requestIds: number[];
  passengerCount: number;
}

export interface VehicleIntervalDistanceMetrics {
  picking_up: number;
  carrying: number;
  total: number;
}

export interface VehicleIntervalLoadMetrics {
  average: number;
  maximum: number;
}

export interface VehicleIntervalEventMetrics {
  pickup: number;
  dropoff: number;
  pickupPassengers: number;
  dropoffPassengers: number;
}

export interface VehicleIntervalRequestMetrics {
  total: number;
  accepted: number;
  cancelled: number;
  pending: number;
}

export interface VehicleIntervalAnalysis {
  vehicleId: number;
  startTime: number;
  endTime: number;
  routeSegments: VehicleIntervalRouteSegment[];
  eventGroups: VehicleIntervalEventGroup[];
  startPoint: NetworkPoint | null;
  endPoint: NetworkPoint | null;
  distance: VehicleIntervalDistanceMetrics;
  load: VehicleIntervalLoadMetrics;
  events: VehicleIntervalEventMetrics;
  requests: VehicleIntervalRequestMetrics;
}

interface VehicleLoadAnalysis {
  metrics: VehicleIntervalLoadMetrics;
}

function movementPhase(
  movement: ReplayVehicleMovement,
): VehicleIntervalPhase {
  return movement.movementType === 'pickup' ? 'picking_up' : 'carrying';
}

function routeSegmentsInInterval(
  movements: readonly ReplayVehicleMovement[],
  vehicleId: number,
  rangeStart: number,
  rangeEnd: number,
): VehicleIntervalRouteSegment[] {
  const segments: VehicleIntervalRouteSegment[] = [];
  const vehicleMovements = movements
    .filter(movement => movement.vehicleId === vehicleId)
    .sort((left, right) =>
      left.startTime - right.startTime ||
      left.endTime - right.endTime ||
      left.requestId - right.requestId,
    );

  for (const movement of vehicleMovements) {
    if (movement.startTime >= rangeEnd || movement.endTime <= rangeStart) continue;
    let edgeStartTime = movement.startTime;

    movement.edges.forEach((edge, edgeIndex) => {
      const edgeTravelTime = Math.max(0, edge.travelTime);
      const travelledFraction = edge.distance > 0
        ? Math.min(1, Math.max(0, edge.distanceTravelled / edge.distance))
        : 0;
      const travelledEndTime = Math.min(
        movement.endTime,
        edgeStartTime + edgeTravelTime * travelledFraction,
      );
      const overlapStart = Math.max(rangeStart, edgeStartTime);
      const overlapEnd = Math.min(rangeEnd, travelledEndTime);

      if (
        edgeTravelTime > 0 &&
        edge.distance > 0 &&
        overlapEnd > overlapStart
      ) {
        const startFraction = Math.min(
          travelledFraction,
          Math.max(0, (overlapStart - edgeStartTime) / edgeTravelTime),
        );
        const endFraction = Math.min(
          travelledFraction,
          Math.max(0, (overlapEnd - edgeStartTime) / edgeTravelTime),
        );
        if (endFraction > startFraction) {
          segments.push({
            id: `${movement.vehicleId}-${movement.startTime}-${movement.requestId}-${edgeIndex}`,
            sequence: segments.length + 1,
            phase: movementPhase(movement),
            requestId: movement.requestId,
            fromNodeId: edge.fromNodeId,
            toNodeId: edge.toNodeId,
            startFraction,
            endFraction,
            startTime: overlapStart,
            endTime: overlapEnd,
            distance: edge.distance * (endFraction - startFraction),
          });
        }
      }
      edgeStartTime += edgeTravelTime;
    });
  }

  return segments.sort((left, right) =>
    left.startTime - right.startTime ||
    left.sequence - right.sequence,
  ).map((segment, index) => ({ ...segment, sequence: index + 1 }));
}

function applyPassengerEvent(
  onboardByRequestId: Map<number, number>,
  event: ReplayPassengerEvent,
): void {
  if (event.type === 'pickup') {
    onboardByRequestId.set(event.passengerId, event.passengerCount);
  } else {
    onboardByRequestId.delete(event.passengerId);
  }
}

function onboardCount(onboardByRequestId: Map<number, number>): number {
  let total = 0;
  for (const count of onboardByRequestId.values()) total += count;
  return total;
}

function vehicleLoadAnalysis(
  passengerEvents: readonly ReplayPassengerEvent[],
  vehicleId: number,
  rangeStart: number,
  rangeEnd: number,
): VehicleLoadAnalysis {
  const events = sortPassengerEvents(
    passengerEvents.filter(event => event.vehicleId === vehicleId),
  );
  const onboardByRequestId = new Map<number, number>();
  let eventIndex = 0;
  while (eventIndex < events.length && events[eventIndex].time <= rangeStart) {
    applyPassengerEvent(onboardByRequestId, events[eventIndex]);
    eventIndex += 1;
  }

  let cursor = rangeStart;
  let maximum = onboardCount(onboardByRequestId);
  let passengerTime = 0;

  while (eventIndex < events.length && events[eventIndex].time <= rangeEnd) {
    const eventTime = events[eventIndex].time;
    const currentLoad = onboardCount(onboardByRequestId);
    if (eventTime > cursor) {
      passengerTime += currentLoad * (eventTime - cursor);
      cursor = eventTime;
    }
    while (eventIndex < events.length && events[eventIndex].time === eventTime) {
      applyPassengerEvent(onboardByRequestId, events[eventIndex]);
      eventIndex += 1;
    }
    maximum = Math.max(maximum, onboardCount(onboardByRequestId));
  }

  const finalLoad = onboardCount(onboardByRequestId);
  if (rangeEnd > cursor) {
    passengerTime += finalLoad * (rangeEnd - cursor);
  }

  const duration = Math.max(0, rangeEnd - rangeStart);
  return {
    metrics: {
      average: duration > 0 ? passengerTime / duration : finalLoad,
      maximum,
    },
  };
}

function intervalEventGroups(
  passengerEvents: readonly ReplayPassengerEvent[],
  vehicleId: number,
  rangeStart: number,
  rangeEnd: number,
): {
  groups: VehicleIntervalEventGroup[];
  metrics: VehicleIntervalEventMetrics;
} {
  const intervalEvents = sortPassengerEvents(
    passengerEvents.filter(event =>
      event.vehicleId === vehicleId &&
      event.time >= rangeStart &&
      event.time <= rangeEnd,
    ),
  );
  const groups: VehicleIntervalEventGroup[] = [];

  for (const event of intervalEvents) {
    const previous = groups[groups.length - 1];
    if (
      previous &&
      previous.time === event.time &&
      previous.type === event.type &&
      previous.nodeId === event.nodeId
    ) {
      previous.requestIds.push(event.passengerId);
      previous.passengerCount += event.passengerCount;
    } else {
      groups.push({
        order: groups.length + 1,
        time: event.time,
        type: event.type,
        nodeId: event.nodeId,
        requestIds: [event.passengerId],
        passengerCount: event.passengerCount,
      });
    }
  }

  return {
    groups,
    metrics: intervalEvents.reduce<VehicleIntervalEventMetrics>(
      (metrics, event) => {
        metrics[event.type] += 1;
        if (event.type === 'pickup') {
          metrics.pickupPassengers += event.passengerCount;
        } else {
          metrics.dropoffPassengers += event.passengerCount;
        }
        return metrics;
      },
      {
        pickup: 0,
        dropoff: 0,
        pickupPassengers: 0,
        dropoffPassengers: 0,
      },
    ),
  };
}

function intervalRequestMetrics(
  passengers: readonly Passenger[],
  rangeStart: number,
  rangeEnd: number,
): VehicleIntervalRequestMetrics {
  const generated = passengers.filter(passenger =>
    passenger.requestTime >= rangeStart &&
    passenger.requestTime <= rangeEnd,
  );
  return generated.reduce<VehicleIntervalRequestMetrics>(
    (metrics, passenger) => {
      metrics.total += 1;
      if (passenger.status === 'cancelled' || passenger.cancellationTime != null) {
        metrics.cancelled += 1;
      } else if (passenger.assignedVehicleId != null) {
        metrics.accepted += 1;
      } else {
        metrics.pending += 1;
      }
      return metrics;
    },
    { total: 0, accepted: 0, cancelled: 0, pending: 0 },
  );
}

function vehiclePointAt(
  frames: SimulationState[],
  vehicleId: number,
  time: number,
): NetworkPoint | null {
  const frame = frameAtOrBefore(frames, time);
  const vehicle = frame?.vehicles.find(candidate => candidate.id === vehicleId);
  return vehicle ? vehiclePosition(vehicle) : null;
}

export function buildVehicleIntervalAnalysis({
  frames,
  movements,
  passengerEvents,
  passengers,
  vehicleId,
  startTime,
  endTime,
}: {
  frames: SimulationState[];
  movements: readonly ReplayVehicleMovement[];
  passengerEvents: readonly ReplayPassengerEvent[];
  passengers: readonly Passenger[];
  vehicleId: number;
  startTime: number;
  endTime: number;
}): VehicleIntervalAnalysis {
  const rangeStart = Math.min(startTime, endTime);
  const rangeEnd = Math.max(startTime, endTime);
  const routeSegments = routeSegmentsInInterval(
    movements,
    vehicleId,
    rangeStart,
    rangeEnd,
  );
  const loadAnalysis = vehicleLoadAnalysis(
    passengerEvents,
    vehicleId,
    rangeStart,
    rangeEnd,
  );
  const phaseDistances = routeSegments.reduce(
    (distances, segment) => {
      distances[segment.phase] += segment.distance;
      return distances;
    },
    { picking_up: 0, carrying: 0 },
  );
  const totalDistance = phaseDistances.picking_up + phaseDistances.carrying;
  const eventAnalysis = intervalEventGroups(
    passengerEvents,
    vehicleId,
    rangeStart,
    rangeEnd,
  );

  return {
    vehicleId,
    startTime: rangeStart,
    endTime: rangeEnd,
    routeSegments,
    eventGroups: eventAnalysis.groups,
    startPoint: vehiclePointAt(frames, vehicleId, rangeStart),
    endPoint: vehiclePointAt(frames, vehicleId, rangeEnd),
    distance: {
      ...phaseDistances,
      total: totalDistance,
    },
    load: loadAnalysis.metrics,
    events: eventAnalysis.metrics,
    requests: intervalRequestMetrics(passengers, rangeStart, rangeEnd),
  };
}
