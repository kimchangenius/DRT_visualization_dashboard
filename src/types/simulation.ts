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

export type VehicleStatus = 'idle' | 'picking_up' | 'carrying' | 'repositioning';

export interface Vehicle {
  id: number;
  currentNodeId: number;
  targetNodeId: number | null;
  path: number[];
  pathProgress: number;
  status: VehicleStatus;
  passengerId: number | null;
  totalTrips: number;
  totalDistance: number;
}

export type PassengerStatus = 'waiting' | 'picked_up' | 'delivered' | 'cancelled';

export interface Passenger {
  id: number;
  originNodeId: number;
  destinationNodeId: number;
  requestTime: number;
  pickupTime: number | null;
  deliveryTime: number | null;
  cancellationTime: number | null;
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

export interface WaitTimeDistribution {
  range: string;
  count: number;
}

export interface TimeSeriesPoint {
  time: number;
  value: number;
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
}

export interface SimulationState extends SimulationConfigPayload {
  metrics: SimulationMetrics;
  vehicles: Vehicle[];
  passengers: Passenger[];
  waitTimeDistribution: WaitTimeDistribution[];
  utilizationHistory: UtilizationTimeSeriesPoint[];
  passengerHistory: PassengerTimeSeriesPoint[];
  requestStatusData: RequestStatusData[];
  linkLoads: Record<string, number>;
}

export type SimulationCommandType = 'start' | 'stop' | 'reset' | 'setSpeed';

export interface SimulationCommand {
  type: SimulationCommandType;
  payload?: number;
}

export interface SimulationConfig {
  speed: number;
  demandRate: number;
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

export interface EfficiencyDatum {
  time: number;
  idlePct: number;
  pickupPct: number;
  carryingPct: number;
}

export interface VehicleTimelineDatum {
  startTime: number;
  endTime: number;
  status: VehicleStatus;
}

export interface EdgeTraversal {
  from: number;
  to: number;
  count: number;
}

export interface NodeActivity {
  nodeId: number;
  pickupCount: number;
  dropoffCount: number;
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
  routeEdges: [number, number][];
  edgeTraversals: EdgeTraversal[];
  nodeActivity: NodeActivity[];
  summary: VehicleAnalysisSummary;
  waitTimeData: WaitTimeBarDatum[];
  detourFactorData: DetourFactorDatum[];
  efficiencyData: EfficiencyDatum[];
  timelineData: VehicleTimelineDatum[];
}
