import type {
  ReplayDispatchDecision,
  ReplayPassengerEvent,
  ReplayVehicleMovement,
  SimulationState,
} from '../types/simulation';
import {
  buildReplayVehicleTemporalIndex,
  encodePassengerEvents,
  orderedUniqueFrames,
  sortPassengerEvents,
} from './vehicleTemporal';
import type { ReplayVehicleTemporalIndex } from './vehicleTemporal';

export interface LoadedReplay {
  name: string;
  runName: string;
  frames: SimulationState[];
  timeMin: number;
  timeMax: number;
  version: 4;
  passengerEvents: ReplayPassengerEvent[];
  vehicleMovements: ReplayVehicleMovement[];
  dispatchDecisions: ReplayDispatchDecision[];
  temporalIndex: ReplayVehicleTemporalIndex;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasNonNegativeNumber(value: unknown): value is number {
  return hasNumber(value) && value >= 0;
}

function hasPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function hasNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function hasNullableNumber(value: unknown): value is number | null {
  return value === null || hasNumber(value);
}

function hasNullablePositiveInteger(value: unknown): value is number | null {
  return value === null || hasPositiveInteger(value);
}

function hasValidOptionalVehicleIds(value: unknown): boolean {
  return (
    value === undefined ||
    (
      Array.isArray(value) &&
      value.every(hasPositiveInteger)
    )
  );
}

function hasValidFeasibilityPoint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const numericFields = [
    value.time,
    value.totalVehicleCount,
    value.availableVehicleCount,
    value.unavailableVehicleCount,
    value.capacityBlockedVehicles,
    value.pickupDeadlineBlockedVehicles,
    value.serviceConstraintBlockedVehicles,
    value.feasibleVehicleCount,
  ];
  return (
    numericFields.every(field => hasNumber(field) && field >= 0) &&
    hasValidOptionalVehicleIds(value.unavailableVehicleIds) &&
    hasValidOptionalVehicleIds(value.capacityBlockedVehicleIds) &&
    hasValidOptionalVehicleIds(value.pickupDeadlineBlockedVehicleIds) &&
    hasValidOptionalVehicleIds(value.serviceConstraintBlockedVehicleIds) &&
    hasValidOptionalVehicleIds(value.feasibleVehicleIds) &&
    (value.nearestPickupEta === null || hasNumber(value.nearestPickupEta))
  );
}

function hasValidCancellationMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (
    value.assignmentTime !== undefined &&
    value.assignmentTime !== null &&
    !hasNumber(value.assignmentTime)
  ) {
    return false;
  }
  if (
    value.feasibilityHistory !== undefined &&
    (
      !Array.isArray(value.feasibilityHistory) ||
      !value.feasibilityHistory.every(hasValidFeasibilityPoint)
    )
  ) {
    return false;
  }
  const reason = value.cancellationReason;
  if (
    reason !== undefined &&
    reason !== null &&
    reason !== 'max_wait_unassigned' &&
    reason !== 'max_wait_after_assignment'
  ) {
    return false;
  }

  const diagnostics = value.cancellationDiagnostics;
  if (diagnostics === undefined || diagnostics === null) return true;
  if (!isRecord(diagnostics)) return false;

  const numericFields = [
    diagnostics.cancellationTime,
    diagnostics.waitingTime,
    diagnostics.totalVehicleCount,
    diagnostics.availableVehicleCount,
    diagnostics.unavailableVehicleCount,
    diagnostics.capacityBlockedVehicles,
    diagnostics.pickupDeadlineBlockedVehicles,
    diagnostics.serviceConstraintBlockedVehicles,
    diagnostics.feasibleVehicleCount,
    diagnostics.feasibleButNotSelectedSteps,
  ];
  return (
    numericFields.every(field => hasNumber(field) && field >= 0) &&
    (diagnostics.assignedVehicleId === null || hasNumber(diagnostics.assignedVehicleId)) &&
    hasValidOptionalVehicleIds(diagnostics.unavailableVehicleIds) &&
    hasValidOptionalVehicleIds(diagnostics.capacityBlockedVehicleIds) &&
    hasValidOptionalVehicleIds(diagnostics.pickupDeadlineBlockedVehicleIds) &&
    hasValidOptionalVehicleIds(diagnostics.serviceConstraintBlockedVehicleIds) &&
    hasValidOptionalVehicleIds(diagnostics.feasibleVehicleIds) &&
    (diagnostics.nearestPickupEta === null || hasNumber(diagnostics.nearestPickupEta))
  );
}

function hasValidMetrics(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return [
    value.currentTime,
    value.totalPassengersServed,
    value.totalPassengersWaiting,
    value.totalPassengersInTransit,
    value.averageWaitTime,
    value.averageTravelTime,
    value.vehicleUtilization,
    value.cancelCount,
    value.activeVehicles,
    value.totalVehicles,
  ].every(hasNonNegativeNumber);
}

function hasValidSimulationConfig(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const numericFields = [
    value.maxNumVehicles,
    value.vehCapacity,
    value.maxNumRequest,
    value.maxWaitTime,
    value.hiddenDim,
    value.batchSize,
    value.learningRate,
    value.scenarioSeed,
  ];
  const scenarios = ['S1', 'S2', 'S3', 'S4'];
  return (
    numericFields.every(hasNonNegativeNumber) &&
    typeof value.selectedScenario === 'string' &&
    scenarios.includes(value.selectedScenario) &&
    Array.isArray(value.availableScenarios) &&
    value.availableScenarios.every(
      scenario => typeof scenario === 'string' && scenarios.includes(scenario),
    ) &&
    (value.modelWeightFile === null || typeof value.modelWeightFile === 'string')
  );
}

function hasValidVehicle(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const pathIsValid = Array.isArray(value.path) &&
    value.path.every(hasPositiveInteger);
  const pathLength = Array.isArray(value.path) ? value.path.length : 0;
  const currentEdgeIndexIsValid = (
    value.currentEdgeIndex === undefined ||
    value.currentEdgeIndex === null ||
    (
      hasNonNegativeInteger(value.currentEdgeIndex) &&
      pathIsValid &&
      value.currentEdgeIndex < pathLength - 1
    )
  );
  return (
    hasPositiveInteger(value.id) &&
    hasPositiveInteger(value.currentNodeId) &&
    hasNullablePositiveInteger(value.targetNodeId) &&
    pathIsValid &&
    hasNonNegativeNumber(value.pathProgress) &&
    value.pathProgress <= 1 &&
    currentEdgeIndexIsValid &&
    (
      value.currentEdgeProgress === undefined ||
      (
        hasNonNegativeNumber(value.currentEdgeProgress) &&
        value.currentEdgeProgress <= 1
      )
    ) &&
    (value.routeDistance === undefined || hasNonNegativeNumber(value.routeDistance)) &&
    (
      value.routeDistanceTravelled === undefined ||
      (
        hasNonNegativeNumber(value.routeDistanceTravelled) &&
        (
          value.routeDistance === undefined ||
          value.routeDistanceTravelled <= value.routeDistance + 1e-6
        )
      )
    ) &&
    (
      value.status === 'idle' ||
      value.status === 'picking_up' ||
      value.status === 'carrying'
    ) &&
    hasNullablePositiveInteger(value.passengerId) &&
    (value.numPassengers === undefined || hasNonNegativeNumber(value.numPassengers)) &&
    hasNonNegativeNumber(value.totalTrips) &&
    hasNonNegativeNumber(value.totalDistance)
  );
}

function hasValidPassenger(value: unknown): boolean {
  if (!isRecord(value) || !hasValidCancellationMetadata(value)) return false;
  return (
    hasPositiveInteger(value.id) &&
    hasPositiveInteger(value.originNodeId) &&
    hasPositiveInteger(value.destinationNodeId) &&
    (value.directTravelTime === undefined || hasNullableNumber(value.directTravelTime)) &&
    (value.numPassengers === undefined || (
      hasPositiveInteger(value.numPassengers)
    )) &&
    hasNonNegativeNumber(value.requestTime) &&
    hasNullableNumber(value.pickupTime) &&
    hasNullableNumber(value.deliveryTime) &&
    hasNullableNumber(value.cancellationTime) &&
    (
      value.status === 'waiting' ||
      value.status === 'picked_up' ||
      value.status === 'delivered' ||
      value.status === 'cancelled'
    ) &&
    hasNullablePositiveInteger(value.assignedVehicleId)
  );
}

function hasValidUtilizationPoint(value: unknown): boolean {
  return isRecord(value) &&
    hasNonNegativeNumber(value.time) &&
    hasNonNegativeNumber(value.utilization);
}

function hasValidPassengerHistoryPoint(value: unknown): boolean {
  return isRecord(value) &&
    hasNonNegativeNumber(value.time) &&
    hasNonNegativeNumber(value.served) &&
    hasNonNegativeNumber(value.waiting) &&
    hasNonNegativeNumber(value.cancelled);
}

function hasValidRequestStatus(value: unknown): boolean {
  return isRecord(value) &&
    typeof value.name === 'string' &&
    hasNonNegativeNumber(value.value) &&
    typeof value.color === 'string';
}

function isSimulationState(value: unknown): value is SimulationState {
  if (
    !isRecord(value) ||
    !hasValidSimulationConfig(value) ||
    !hasValidMetrics(value.metrics)
  ) {
    return false;
  }
  return (
    Array.isArray(value.vehicles) &&
    value.vehicles.every(hasValidVehicle) &&
    Array.isArray(value.passengers) &&
    value.passengers.every(hasValidPassenger) &&
    (
      value.vehicleMovementEvents === undefined ||
      (
        Array.isArray(value.vehicleMovementEvents) &&
        value.vehicleMovementEvents.every(isReplayVehicleMovement)
      )
    ) &&
    (
      value.dispatchDecisionEvents === undefined ||
      (
        Array.isArray(value.dispatchDecisionEvents) &&
        value.dispatchDecisionEvents.every(isReplayDispatchDecision)
      )
    ) &&
    Array.isArray(value.utilizationHistory) &&
    value.utilizationHistory.every(hasValidUtilizationPoint) &&
    Array.isArray(value.passengerHistory) &&
    value.passengerHistory.every(hasValidPassengerHistoryPoint) &&
    Array.isArray(value.requestStatusData) &&
    value.requestStatusData.every(hasValidRequestStatus)
  );
}

function isReplayPassengerEvent(value: unknown): value is ReplayPassengerEvent {
  if (!isRecord(value)) return false;
  return (
    hasNonNegativeNumber(value.time) &&
    (value.type === 'pickup' || value.type === 'dropoff') &&
    hasPositiveInteger(value.vehicleId) &&
    hasPositiveInteger(value.passengerId) &&
    hasPositiveInteger(value.passengerCount) &&
    hasPositiveInteger(value.nodeId)
  );
}

function isReplayDispatchDecision(value: unknown): value is ReplayDispatchDecision {
  if (!isRecord(value)) return false;
  const actionTypeIsValid =
    value.actionType === 'pickup' ||
    value.actionType === 'dropoff' ||
    value.actionType === 'wait';
  if (
    !hasNonNegativeNumber(value.time) ||
    !hasNonNegativeInteger(value.decisionRound) ||
    !hasPositiveInteger(value.vehicleId) ||
    !actionTypeIsValid ||
    !Array.isArray(value.pickupCandidateRequestIds) ||
    !value.pickupCandidateRequestIds.every(hasPositiveInteger) ||
    new Set(value.pickupCandidateRequestIds).size !== value.pickupCandidateRequestIds.length
  ) {
    return false;
  }
  const requestIsValid = value.actionType === 'wait'
    ? value.requestId === null
    : hasPositiveInteger(value.requestId);
  if (!requestIsValid) return false;
  if (value.actionType !== 'pickup') return true;
  return (
    hasPositiveInteger(value.requestId) &&
    value.pickupCandidateRequestIds.includes(value.requestId)
  );
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-6 * Math.max(1, Math.abs(left), Math.abs(right));
}

function isReplayVehicleMovement(value: unknown): value is ReplayVehicleMovement {
  if (!isRecord(value)) return false;
  if (
    !hasPositiveInteger(value.vehicleId) ||
    !hasPositiveInteger(value.requestId) ||
    (value.movementType !== 'pickup' && value.movementType !== 'dropoff') ||
    !hasNonNegativeNumber(value.startTime) ||
    !hasNonNegativeNumber(value.endTime) ||
    value.endTime < value.startTime ||
    !hasNonNegativeNumber(value.scheduledEndTime) ||
    value.scheduledEndTime < value.startTime ||
    (
      value.endReason !== 'arrived' &&
      value.endReason !== 'cancelled' &&
      value.endReason !== 'in_progress'
    ) ||
    !Array.isArray(value.routeNodeIds) ||
    value.routeNodeIds.length === 0 ||
    !value.routeNodeIds.every(hasPositiveInteger) ||
    !Array.isArray(value.edges) ||
    value.edges.length !== value.routeNodeIds.length - 1 ||
    !hasNonNegativeNumber(value.plannedDistance) ||
    !hasNonNegativeNumber(value.travelledDistance) ||
    value.travelledDistance > value.plannedDistance + 1e-6 ||
    !hasNonNegativeNumber(value.cumulativeDistance) ||
    value.cumulativeDistance + 1e-6 < value.travelledDistance
  ) {
    return false;
  }

  let plannedDistance = 0;
  let travelledDistance = 0;
  for (let index = 0; index < value.edges.length; index += 1) {
    const edge = value.edges[index];
    if (
      !isRecord(edge) ||
      !hasPositiveInteger(edge.fromNodeId) ||
      !hasPositiveInteger(edge.toNodeId) ||
      edge.fromNodeId !== value.routeNodeIds[index] ||
      edge.toNodeId !== value.routeNodeIds[index + 1] ||
      !hasNumber(edge.travelTime) ||
      edge.travelTime <= 0 ||
      !hasNumber(edge.distance) ||
      edge.distance <= 0 ||
      !hasNonNegativeNumber(edge.distanceTravelled) ||
      edge.distanceTravelled > edge.distance + 1e-6
    ) {
      return false;
    }
    plannedDistance += edge.distance;
    travelledDistance += edge.distanceTravelled;
  }

  return (
    approximatelyEqual(plannedDistance, value.plannedDistance) &&
    approximatelyEqual(travelledDistance, value.travelledDistance)
  );
}

export function parseReplayPayload(payload: unknown, fileName: string): LoadedReplay {
  if (!isRecord(payload)) {
    throw new Error('The file must contain a replay JSON object.');
  }
  if (payload.version !== 4) {
    throw new Error('Only Replay v4 files are supported. Save a new replay and try again.');
  }
  if (!Array.isArray(payload.frames) || payload.frames.length === 0) {
    throw new Error('Replay file must include at least one frame.');
  }
  if (!payload.frames.every(isSimulationState)) {
    throw new Error('Replay frames do not match the dashboard state format.');
  }
  if (
    !Array.isArray(payload.passengerEvents) ||
    !payload.passengerEvents.every(isReplayPassengerEvent)
  ) {
    throw new Error('Replay v4 must include valid passengerEvents.');
  }
  if (
    payload.distanceUnit !== 'network_distance_unit' ||
    !Array.isArray(payload.vehicleMovements) ||
    !payload.vehicleMovements.every(isReplayVehicleMovement)
  ) {
    throw new Error('Replay v4 must include valid vehicleMovements and distanceUnit.');
  }
  if (
    !Array.isArray(payload.dispatchDecisions) ||
    !payload.dispatchDecisions.every(isReplayDispatchDecision)
  ) {
    throw new Error('Replay v4 must include valid dispatchDecisions.');
  }
  if (payload.config !== undefined && !hasValidSimulationConfig(payload.config)) {
    throw new Error('Replay config does not match the dashboard format.');
  }

  const frames = orderedUniqueFrames(payload.frames);
  const runName = typeof payload.runName === 'string' && payload.runName.trim()
    ? payload.runName
    : fileName;
  const passengerEvents = sortPassengerEvents(
    payload.passengerEvents as ReplayPassengerEvent[],
  );
  const vehicleMovements = [...payload.vehicleMovements as ReplayVehicleMovement[]].sort(
    (left, right) =>
      left.startTime - right.startTime ||
      left.vehicleId - right.vehicleId ||
      left.requestId - right.requestId,
  );
  const dispatchDecisions = [...payload.dispatchDecisions as ReplayDispatchDecision[]].sort(
    (left, right) =>
      left.time - right.time ||
      left.decisionRound - right.decisionRound ||
      left.vehicleId - right.vehicleId,
  );
  const vehicleIds = new Set<number>();
  const passengerIds = new Set<number>();
  for (const frame of frames) {
    for (const vehicle of frame.vehicles) vehicleIds.add(vehicle.id);
    for (const passenger of frame.passengers) passengerIds.add(passenger.id);
  }
  if (passengerEvents.some(event =>
    !vehicleIds.has(event.vehicleId) || !passengerIds.has(event.passengerId)
  )) {
    throw new Error('Replay passengerEvents reference unknown vehicles or requests.');
  }
  const expectedEvents = encodePassengerEvents(frames);
  const hasEventMismatch =
    expectedEvents.length !== passengerEvents.length ||
    expectedEvents.some((expected, index) => {
      const actual = passengerEvents[index];
      return (
        expected.time !== actual.time ||
        expected.type !== actual.type ||
        expected.vehicleId !== actual.vehicleId ||
        expected.passengerId !== actual.passengerId ||
        expected.passengerCount !== actual.passengerCount ||
        expected.nodeId !== actual.nodeId
      );
    });
  if (hasEventMismatch) {
    throw new Error('Replay passengerEvents do not match pickup and drop-off frame data.');
  }
  if (vehicleMovements.some(movement =>
    !vehicleIds.has(movement.vehicleId) || !passengerIds.has(movement.requestId)
  )) {
    throw new Error('Replay vehicleMovements reference unknown vehicles or requests.');
  }
  if (dispatchDecisions.some(decision =>
    !vehicleIds.has(decision.vehicleId) ||
    (
      decision.requestId != null &&
      !passengerIds.has(decision.requestId)
    ) ||
    decision.pickupCandidateRequestIds.some(requestId => !passengerIds.has(requestId)) ||
    decision.time < frames[0].metrics.currentTime ||
    decision.time > frames[frames.length - 1].metrics.currentTime
  )) {
    throw new Error('Replay dispatchDecisions reference unknown entities or times.');
  }
  const dispatchDecisionKeys = new Set(dispatchDecisions.map(decision =>
    `${decision.time}:${decision.decisionRound}:${decision.vehicleId}`,
  ));
  if (dispatchDecisionKeys.size !== dispatchDecisions.length) {
    throw new Error('Replay dispatchDecisions contain duplicate vehicle decisions.');
  }
  const temporalIndex = buildReplayVehicleTemporalIndex(
    frames,
    passengerEvents,
  );

  return {
    name: fileName,
    runName,
    frames,
    timeMin: frames[0].metrics.currentTime,
    timeMax: frames[frames.length - 1].metrics.currentTime,
    version: payload.version,
    passengerEvents,
    vehicleMovements,
    dispatchDecisions,
    temporalIndex,
  };
}

export function parseReplayText(text: string, fileName: string): LoadedReplay {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('The selected file is not valid JSON.');
  }

  return parseReplayPayload(payload, fileName);
}
