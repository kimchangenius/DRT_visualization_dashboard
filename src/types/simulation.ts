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
}

export interface TripStatusData {
  name: string;
  value: number;
  color: string;
}

export interface SimulationState {
  metrics: SimulationMetrics;
  vehicles: Vehicle[];
  passengers: Passenger[];
  waitTimeDistribution: WaitTimeDistribution[];
  utilizationHistory: UtilizationTimeSeriesPoint[];
  passengerHistory: PassengerTimeSeriesPoint[];
  tripStatusData: TripStatusData[];
  linkLoads: Record<string, number>;
}

export type SimulationCommandType = 'start' | 'stop' | 'reset' | 'setSpeed' | 'setVehicleCount';

export interface SimulationCommand {
  type: SimulationCommandType;
  payload?: number;
}

export interface SimulationConfig {
  vehicleCount: number;
  speed: number;
  demandRate: number;
}
