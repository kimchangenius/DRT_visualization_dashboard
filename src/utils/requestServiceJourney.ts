import type {
  Passenger,
  ReplayPassengerEvent,
  ReplayVehicleMovement,
} from '../types/simulation';

export type RequestJourneyPhase = 'approach' | 'onboard';

export interface RequestJourneyEdge {
  id: string;
  phase: RequestJourneyPhase;
  sequence: number;
  fromNodeId: number;
  toNodeId: number;
  travelTime: number;
  distance: number;
  distanceTravelled: number;
  edgeStartTime: number;
  edgeEndTime: number;
  actionRequestId: number;
  actionType: ReplayVehicleMovement['movementType'];
  movementEndReason: ReplayVehicleMovement['endReason'];
}

export interface RequestJourneyStop {
  id: string;
  time: number;
  type: ReplayPassengerEvent['type'];
  nodeId: number;
  requestIds: number[];
  passengerCount: number;
}

export interface RequestServiceJourney {
  requestId: number;
  vehicleId: number | null;
  assignmentTime: number | null;
  pickupTime: number | null;
  deliveryTime: number | null;
  assignmentNodeId: number | null;
  approachEdges: RequestJourneyEdge[];
  onboardEdges: RequestJourneyEdge[];
  coRiderStops: RequestJourneyStop[];
}

function movementEdges(
  movements: ReplayVehicleMovement[],
  phase: RequestJourneyPhase,
): RequestJourneyEdge[] {
  const edges: RequestJourneyEdge[] = [];
  let sequence = 0;

  movements.forEach((movement, movementIndex) => {
    let edgeStartTime = movement.startTime;
    movement.edges.forEach((edge, edgeIndex) => {
      const edgeEndTime = edgeStartTime + edge.travelTime;
      edges.push({
        id: [
          phase,
          movement.vehicleId,
          movement.startTime,
          movement.requestId,
          movementIndex,
          edgeIndex,
        ].join('-'),
        phase,
        sequence,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        travelTime: edge.travelTime,
        distance: edge.distance,
        distanceTravelled: edge.distanceTravelled,
        edgeStartTime,
        edgeEndTime,
        actionRequestId: movement.requestId,
        actionType: movement.movementType,
        movementEndReason: movement.endReason,
      });
      sequence += 1;
      edgeStartTime = edgeEndTime;
    });
  });

  return edges;
}

function coRiderStops(
  events: ReplayPassengerEvent[],
  selectedRequestId: number,
  vehicleId: number | null,
  pickupTime: number | null,
  journeyEndTime: number,
): RequestJourneyStop[] {
  if (vehicleId == null || pickupTime == null) return [];

  const grouped = new Map<string, RequestJourneyStop>();
  for (const event of events) {
    if (
      event.vehicleId !== vehicleId ||
      event.passengerId === selectedRequestId ||
      event.time < pickupTime ||
      event.time > journeyEndTime
    ) {
      continue;
    }
    const id = `${event.time}-${event.type}-${event.nodeId}`;
    const stop = grouped.get(id) ?? {
      id,
      time: event.time,
      type: event.type,
      nodeId: event.nodeId,
      requestIds: [],
      passengerCount: 0,
    };
    stop.requestIds.push(event.passengerId);
    stop.passengerCount += event.passengerCount;
    grouped.set(id, stop);
  }

  return [...grouped.values()]
    .map(stop => ({
      ...stop,
      requestIds: [...stop.requestIds].sort((left, right) => left - right),
    }))
    .sort((left, right) =>
      left.time - right.time ||
      left.nodeId - right.nodeId ||
      left.type.localeCompare(right.type)
    );
}

export function buildRequestServiceJourney(
  passenger: Passenger,
  movements: ReplayVehicleMovement[],
  events: ReplayPassengerEvent[],
  currentTime: number,
): RequestServiceJourney {
  const requestMovements = movements.filter(
    movement => movement.requestId === passenger.id,
  );
  const requestEvents = events.filter(event => event.passengerId === passenger.id);
  const vehicleId = passenger.assignedVehicleId ??
    requestEvents[0]?.vehicleId ??
    requestMovements[0]?.vehicleId ??
    null;
  const orderedVehicleMovements = movements
    .filter(movement => vehicleId != null && movement.vehicleId === vehicleId)
    .sort((left, right) =>
      left.startTime - right.startTime ||
      left.endTime - right.endTime ||
      left.requestId - right.requestId
    );
  const approachMovements = orderedVehicleMovements.filter(
    movement =>
      movement.requestId === passenger.id &&
      movement.movementType === 'pickup' &&
      (
        passenger.pickupTime == null ||
        movement.startTime <= passenger.pickupTime
      ),
  );
  const pickupTime = passenger.pickupTime;
  const journeyEndTime = Math.max(
    pickupTime ?? passenger.assignmentTime ?? passenger.requestTime,
    passenger.deliveryTime ?? currentTime,
  );
  const onboardMovements = pickupTime == null
    ? []
    : orderedVehicleMovements.filter(
      movement =>
        movement.endTime > pickupTime &&
        movement.startTime < journeyEndTime,
    );
  const approachEdges = movementEdges(approachMovements, 'approach');
  const onboardEdges = movementEdges(onboardMovements, 'onboard');

  return {
    requestId: passenger.id,
    vehicleId,
    assignmentTime: passenger.assignmentTime ?? null,
    pickupTime,
    deliveryTime: passenger.deliveryTime,
    assignmentNodeId:
      approachMovements[0]?.routeNodeIds[0] ??
      (passenger.assignmentTime === passenger.pickupTime
        ? passenger.originNodeId
        : null),
    approachEdges,
    onboardEdges,
    coRiderStops: coRiderStops(
      events,
      passenger.id,
      vehicleId,
      pickupTime,
      journeyEndTime,
    ),
  };
}
