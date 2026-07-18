import type {
  Passenger,
  ReplayPassengerEvent,
  SimulationState,
  Vehicle,
  VehiclePassengerLoadDatum,
  VehicleStatus,
  VehicleTimelineDatum,
} from '../types/simulation';

export function orderedUniqueFrames(frames: SimulationState[]): SimulationState[] {
  const framesByTime = new Map<number, SimulationState>();
  for (const frame of frames) {
    framesByTime.set(frame.metrics.currentTime, frame);
  }
  return [...framesByTime.values()].sort(
    (a, b) => a.metrics.currentTime - b.metrics.currentTime,
  );
}

export function passengerUnitCount(passenger: Passenger): number {
  const count = passenger.numPassengers;
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 1;
}

export function onboardPassengersForVehicle(
  frame: SimulationState,
  vehicleId: number,
): Passenger[] {
  const time = frame.metrics.currentTime;
  return frame.passengers.filter(passenger => {
    if (passenger.assignedVehicleId !== vehicleId) return false;
    if (passenger.status === 'cancelled') return false;
    if (passenger.pickupTime == null || passenger.pickupTime > time) return false;
    if (passenger.deliveryTime != null && passenger.deliveryTime <= time) return false;
    return true;
  });
}

export function vehicleOnboardPassengerCount(
  vehicle: Vehicle | undefined,
  onboardPassengers: Passenger[],
): number {
  const encodedCount = vehicle?.numPassengers;
  if (
    typeof encodedCount === 'number' &&
    Number.isFinite(encodedCount)
  ) {
    return Math.max(0, encodedCount);
  }
  return onboardPassengers.reduce(
    (count, passenger) => count + passengerUnitCount(passenger),
    0,
  );
}

export function onboardPassengerLabels(passengers: Passenger[]): string[] {
  return passengers.map(passenger => {
    const count = passengerUnitCount(passenger);
    return count > 1 ? `P${passenger.id} x${count}` : `P${passenger.id}`;
  });
}

export function onboardPassengerSignature(passengers: Passenger[]): string {
  return passengers
    .map(passenger => `${passenger.id}:${passengerUnitCount(passenger)}`)
    .sort()
    .join('|');
}

export function inferVehicleTimelineStatus(
  frame: SimulationState,
  vehicleId: number,
  fallbackStatus: VehicleStatus,
): VehicleStatus {
  if (fallbackStatus !== 'idle' && fallbackStatus !== 'repositioning') {
    return fallbackStatus;
  }

  const time = frame.metrics.currentTime;
  const assignedPassengers = frame.passengers.filter(
    passenger => passenger.assignedVehicleId === vehicleId,
  );
  const hasOnboardPassenger = assignedPassengers.some(
    passenger =>
      passenger.status !== 'cancelled' &&
      passenger.pickupTime != null &&
      passenger.pickupTime <= time &&
      (passenger.deliveryTime == null || passenger.deliveryTime > time),
  );
  if (hasOnboardPassenger) return 'carrying';

  const hasPickupTarget = assignedPassengers.some(
    passenger =>
      passenger.status === 'waiting' &&
      passenger.requestTime <= time &&
      (passenger.pickupTime == null || passenger.pickupTime > time),
  );
  return hasPickupTarget ? 'picking_up' : fallbackStatus;
}

export function encodePassengerEvents(
  frames: SimulationState[],
): ReplayPassengerEvent[] {
  const latestPassengers = new Map<number, Passenger>();
  const assignedVehicleByPassenger = new Map<number, number>();
  for (const frame of orderedUniqueFrames(frames)) {
    for (const passenger of frame.passengers) {
      latestPassengers.set(passenger.id, passenger);
      if (passenger.assignedVehicleId != null) {
        assignedVehicleByPassenger.set(passenger.id, passenger.assignedVehicleId);
      }
    }
  }

  const events: ReplayPassengerEvent[] = [];
  for (const passenger of latestPassengers.values()) {
    const vehicleId = passenger.assignedVehicleId ??
      assignedVehicleByPassenger.get(passenger.id) ??
      null;
    if (vehicleId == null) continue;
    const passengerCount = passengerUnitCount(passenger);
    if (passenger.pickupTime != null) {
      events.push({
        time: passenger.pickupTime,
        type: 'pickup',
        vehicleId,
        passengerId: passenger.id,
        passengerCount,
        nodeId: passenger.originNodeId,
      });
    }
    if (passenger.deliveryTime != null) {
      events.push({
        time: passenger.deliveryTime,
        type: 'dropoff',
        vehicleId,
        passengerId: passenger.id,
        passengerCount,
        nodeId: passenger.destinationNodeId,
      });
    }
  }

  return sortPassengerEvents(events);
}

export function sortPassengerEvents(
  events: readonly ReplayPassengerEvent[],
): ReplayPassengerEvent[] {
  return [...events].sort((a, b) =>
    a.time - b.time ||
    a.vehicleId - b.vehicleId ||
    a.passengerId - b.passengerId ||
    (a.type === b.type ? 0 : a.type === 'pickup' ? -1 : 1),
  );
}

export function buildVehiclePassengerLoadData(
  frames: SimulationState[],
  vehicleId: number,
  encodedEvents?: ReplayPassengerEvent[],
): VehiclePassengerLoadDatum[] {
  const vehicleEvents = encodedEvents
    ? sortPassengerEvents(
      encodedEvents.filter(event => event.vehicleId === vehicleId),
    )
    : undefined;
  const onboardByPassengerId = new Map<number, number>();
  let eventIndex = 0;
  const data: VehiclePassengerLoadDatum[] = [];

  for (const frame of orderedUniqueFrames(frames)) {
    const vehicle = frame.vehicles.find(candidate => candidate.id === vehicleId);
    if (!vehicle) continue;
    const time = frame.metrics.currentTime;

    if (vehicleEvents) {
      while (eventIndex < vehicleEvents.length && vehicleEvents[eventIndex].time <= time) {
        const event = vehicleEvents[eventIndex];
        if (event.type === 'pickup') {
          onboardByPassengerId.set(event.passengerId, event.passengerCount);
        } else {
          onboardByPassengerId.delete(event.passengerId);
        }
        eventIndex += 1;
      }
      const entries = [...onboardByPassengerId.entries()]
        .sort(([leftId], [rightId]) => leftId - rightId);
      data.push({
        time,
        onboardPassengers: entries.reduce((total, [, count]) => total + count, 0),
        onboardPassengerIds: entries.map(([passengerId]) => passengerId),
        onboardPassengerLabels: entries.map(([passengerId, count]) => (
          count > 1 ? `P${passengerId} x${count}` : `P${passengerId}`
        )),
      });
      continue;
    }

    const onboardPassengers = onboardPassengersForVehicle(frame, vehicleId);
    data.push({
      time,
      onboardPassengers: vehicleOnboardPassengerCount(vehicle, onboardPassengers),
      onboardPassengerIds: onboardPassengers.map(passenger => passenger.id),
      onboardPassengerLabels: onboardPassengerLabels(onboardPassengers),
    });
  }
  return data;
}

export function buildVehicleTimelineData(
  frames: SimulationState[],
  vehicleId: number,
): VehicleTimelineDatum[] {
  const segments: VehicleTimelineDatum[] = [];
  let active: VehicleTimelineDatum | null = null;
  let activePassengerSignature = '';

  for (const frame of orderedUniqueFrames(frames)) {
    const vehicle = frame.vehicles.find(candidate => candidate.id === vehicleId);
    if (!vehicle) continue;

    const time = frame.metrics.currentTime;
    const status = inferVehicleTimelineStatus(frame, vehicleId, vehicle.status);
    const passengerSignature = onboardPassengerSignature(
      onboardPassengersForVehicle(frame, vehicleId),
    );
    if (!active) {
      activePassengerSignature = passengerSignature;
      active = { startTime: time, endTime: time, status };
      segments.push(active);
      continue;
    }

    const hasPassengerEvent = activePassengerSignature !== passengerSignature;
    if (active.status !== status || hasPassengerEvent) {
      active.endTime = Math.max(active.endTime, time);
      active = {
        startTime: time,
        endTime: time,
        status,
        hasPassengerEvent,
      };
      activePassengerSignature = passengerSignature;
      segments.push(active);
    } else {
      active.endTime = Math.max(active.endTime, time);
    }
  }

  if (active) {
    active.endTime = Math.max(active.endTime, active.startTime + 1);
  }
  return segments;
}

export function latestPassengersEverAssignedToVehicle(
  frames: SimulationState[],
  vehicleId: number,
): Passenger[] {
  const assignedPassengerIds = new Set<number>();
  const latestPassengers = new Map<number, Passenger>();
  for (const frame of orderedUniqueFrames(frames)) {
    for (const passenger of frame.passengers) {
      if (passenger.assignedVehicleId === vehicleId) {
        assignedPassengerIds.add(passenger.id);
      }
      if (assignedPassengerIds.has(passenger.id)) {
        latestPassengers.set(passenger.id, passenger);
      }
    }
  }
  return [...latestPassengers.values()].sort(
    (a, b) => a.requestTime - b.requestTime || a.id - b.id,
  );
}
