export interface NetworkNode {
  id: number;
  x: number;
  y: number;
  label: string;
}

export interface NetworkLink {
  id: number;
  from: number;
  to: number;
  distance: number;
  freeFlowTime: number;
}

export type VehicleStatus = 'idle' | 'picking_up' | 'carrying';

export interface Vehicle {
  id: number;
  currentNodeId: number;
  targetNodeId: number | null;
  path: number[];
  pathProgress: number;
  currentEdgeIndex?: number | null;
  currentEdgeProgress?: number;
  routeDistance?: number;
  routeDistanceTravelled?: number;
  status: VehicleStatus;
  passengerId: number | null;
  numPassengers?: number;
  totalTrips: number;
  totalDistance: number;
}

export type PassengerStatus = 'waiting' | 'picked_up' | 'delivered' | 'cancelled';

export type CancellationReason =
  | 'max_wait_unassigned'
  | 'max_wait_after_assignment';

export interface CancellationDiagnostics {
  cancellationTime: number;
  waitingTime: number;
  assignedVehicleId: number | null;
  totalVehicleCount: number;
  availableVehicleCount: number;
  unavailableVehicleCount: number;
  unavailableVehicleIds?: number[];
  capacityBlockedVehicles: number;
  capacityBlockedVehicleIds?: number[];
  pickupDeadlineBlockedVehicles: number;
  pickupDeadlineBlockedVehicleIds?: number[];
  serviceConstraintBlockedVehicles: number;
  serviceConstraintBlockedVehicleIds?: number[];
  feasibleVehicleCount: number;
  feasibleVehicleIds?: number[];
  nearestPickupEta: number | null;
  feasibleButNotSelectedSteps: number;
}

export interface CancellationFeasibilityPoint {
  time: number;
  totalVehicleCount: number;
  availableVehicleCount: number;
  unavailableVehicleCount: number;
  unavailableVehicleIds?: number[];
  capacityBlockedVehicles: number;
  capacityBlockedVehicleIds?: number[];
  pickupDeadlineBlockedVehicles: number;
  pickupDeadlineBlockedVehicleIds?: number[];
  serviceConstraintBlockedVehicles: number;
  serviceConstraintBlockedVehicleIds?: number[];
  feasibleVehicleCount: number;
  feasibleVehicleIds?: number[];
  nearestPickupEta: number | null;
}

export interface Passenger {
  id: number;
  originNodeId: number;
  destinationNodeId: number;
  directTravelTime?: number | null;
  numPassengers?: number;
  requestTime: number;
  pickupTime: number | null;
  deliveryTime: number | null;
  cancellationTime: number | null;
  assignmentTime?: number | null;
  cancellationReason?: CancellationReason | null;
  cancellationDiagnostics?: CancellationDiagnostics | null;
  feasibilityHistory?: CancellationFeasibilityPoint[];
  status: PassengerStatus;
  assignedVehicleId: number | null;
}

export interface SimulationMetrics {
  currentTime: number;
  totalPassengersServed: number;
  totalPassengersWaiting: number;
  totalPassengersInTransit: number;
  averageWaitTime: number;
  averageTravelTime: number;
  vehicleUtilization: number;
  cancelCount: number;
  activeVehicles: number;
  totalVehicles: number;
}

export interface UtilizationTimeSeriesPoint {
  time: number;
  utilization: number;
}

export interface PassengerTimeSeriesPoint {
  time: number;
  served: number;
  waiting: number;
  cancelled: number;
}

export type DemandScenario = 'S1' | 'S2' | 'S3' | 'S4';

export interface RequestStatusData {
  name: string;
  value: number;
  color: string;
}

export interface SimulationConfigPayload {
  maxNumVehicles: number;
  vehCapacity: number;
  maxNumRequest: number;
  maxWaitTime: number;
  hiddenDim: number;
  batchSize: number;
  learningRate: number;
  selectedScenario: DemandScenario;
  availableScenarios: DemandScenario[];
  scenarioSeed: number;
  modelWeightFile: string | null;
}

export interface SimulationState extends SimulationConfigPayload {
  metrics: SimulationMetrics;
  vehicles: Vehicle[];
  passengers: Passenger[];
  vehicleMovementEvents?: ReplayVehicleMovement[];
  dispatchDecisionEvents?: ReplayDispatchDecision[];
  utilizationHistory: UtilizationTimeSeriesPoint[];
  passengerHistory: PassengerTimeSeriesPoint[];
  requestStatusData: RequestStatusData[];
}

export interface ReplayPassengerEvent {
  time: number;
  type: 'pickup' | 'dropoff';
  vehicleId: number;
  passengerId: number;
  passengerCount: number;
  nodeId: number;
}

export interface ReplayVehicleMovementEdge {
  fromNodeId: number;
  toNodeId: number;
  travelTime: number;
  distance: number;
  distanceTravelled: number;
}

export interface ReplayVehicleMovement {
  vehicleId: number;
  requestId: number;
  movementType: 'pickup' | 'dropoff';
  startTime: number;
  endTime: number;
  scheduledEndTime: number;
  endReason: 'arrived' | 'cancelled' | 'in_progress';
  routeNodeIds: number[];
  edges: ReplayVehicleMovementEdge[];
  plannedDistance: number;
  travelledDistance: number;
  cumulativeDistance: number;
}

export interface ReplayDispatchDecision {
  time: number;
  decisionRound: number;
  vehicleId: number;
  actionType: 'pickup' | 'dropoff' | 'wait';
  requestId: number | null;
  pickupCandidateRequestIds: number[];
}

export interface SimulationReplayPayload {
  version: 4;
  generatedAt: string;
  runName: string;
  config: SimulationConfigPayload;
  frames: SimulationState[];
  passengerEvents: ReplayPassengerEvent[];
  distanceUnit: 'network_distance_unit';
  vehicleMovements: ReplayVehicleMovement[];
  dispatchDecisions: ReplayDispatchDecision[];
}

export interface WaitTimeBarDatum {
  passengerId: number;
  waitTime: number;
  requestTime: number;
  pickupTime: number;
}

export interface DetourFactorDatum {
  passengerId: number;
  detourFactor: number;
  actualTravelTime: number;
  directTravelTime: number;
  deliveryTime: number;
}

export interface VehicleTimelineDatum {
  startTime: number;
  endTime: number;
  status: VehicleStatus;
  passengerCount?: number;
  hasPassengerEvent?: boolean;
}

export interface VehiclePassengerLoadDatum {
  time: number;
  onboardPassengers: number;
  onboardPassengerIds?: number[];
  onboardPassengerLabels?: string[];
}

export interface VehiclePatternSelection {
  resultSide: 'left' | 'right';
  resultLabel: string;
  vehicleId: number;
  status: Extract<VehicleStatus, 'idle' | 'picking_up' | 'carrying'> | 'range';
  startTime: number;
  endTime: number;
}

export interface EdgeTraversal {
  from: number;
  to: number;
  count: number;
}

export interface VehicleAnalysisSummary {
  totalDistance: number;
  totalTrips: number;
  servedPassengers: number;
  cancelledPassengers: number;
  avgWaitTime: number;
  avgDetourFactor: number;
  maxWaitTime: number;
  idlePct: number;
  pickupPct: number;
  carryingPct: number;
  serviceRate: number;
  distancePerTrip: number;
}

export interface VehicleAnalysis {
  vehicleId: number;
  metrics: SimulationMetrics;
  currentVehicle: Vehicle | null;
  replayVehicles: Vehicle[];
  replayPassengers: Passenger[];
  assignedPassengers: Passenger[];
  edgeTraversals: EdgeTraversal[];
  summary: VehicleAnalysisSummary;
  waitTimeData: WaitTimeBarDatum[];
  detourFactorData: DetourFactorDatum[];
  timelineData: VehicleTimelineDatum[];
  passengerLoadData: VehiclePassengerLoadDatum[];
}
