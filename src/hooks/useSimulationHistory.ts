import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SimulationState,
  SimulationMetrics,
  SimulationConfigPayload,
  SimulationReplayPayload,
  Passenger,
  Vehicle,
  VehicleAnalysis,
  VehicleAnalysisSummary,
  EdgeTraversal,
  NodeActivity,
  WaitTimeBarDatum,
  DetourFactorDatum,
  EfficiencyDatum,
  VehicleTimelineDatum,
  VehiclePassengerLoadDatum,
  VehicleStatus,
} from '../types/simulation';
import { shortestTravelTime } from '../data/siouxFallsNetwork';
import { PLAYBACK_INTERVAL_MS } from '../config';
import { frameAtOrBefore } from '../utils/replay';

type StatusShare = Pick<VehicleAnalysisSummary, 'idlePct' | 'pickupPct' | 'carryingPct'>;

function getOrderedFrames(frames: SimulationState[]): SimulationState[] {
  const framesByTime = new Map<number, SimulationState>();
  for (const frame of frames) {
    framesByTime.set(frame.metrics.currentTime, frame);
  }
  return Array.from(framesByTime.values()).sort(
    (a, b) => a.metrics.currentTime - b.metrics.currentTime,
  );
}

function collectEdgeAnalysis(frames: SimulationState[], vehicleId: number) {
  const edgeSet = new Set<string>();
  const routeEdges: [number, number][] = [];
  const edgeCountMap = new Map<string, EdgeTraversal>();
  let lastPathSig = '';

  for (const frame of frames) {
    const v = frame.vehicles.find(veh => veh.id === vehicleId);
    if (!v || v.path.length < 2) continue;

    const pathSig = `${v.path.join('|')}-${v.status}`;
    if (pathSig === lastPathSig) continue;
    lastPathSig = pathSig;

    for (let i = 0; i < v.path.length - 1; i++) {
      const a = v.path[i];
      const b = v.path[i + 1];
      const key = `${a}-${b}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        routeEdges.push([a, b]);
      }
      const existing = edgeCountMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeCountMap.set(key, { from: a, to: b, count: 1 });
      }
    }
  }

  return {
    routeEdges,
    edgeTraversals: Array.from(edgeCountMap.values()),
  };
}

function calculateStatusShare(timelineData: VehicleTimelineDatum[], replayTime: number): StatusShare {
  const clampedReplayTime = Math.max(0, replayTime);
  const durations = { idle: 0, picking_up: 0, carrying: 0 };

  for (const segment of timelineData) {
    const start = Math.max(0, segment.startTime);
    const end = Math.min(clampedReplayTime, segment.endTime);
    if (end <= start) continue;

    if (segment.status === 'picking_up') durations.picking_up += end - start;
    else if (segment.status === 'carrying') durations.carrying += end - start;
    else durations.idle += end - start;
  }

  const total = durations.idle + durations.picking_up + durations.carrying;
  if (total <= 0) {
    const activeSegment = timelineData.find(
      segment => segment.startTime <= clampedReplayTime && segment.endTime >= clampedReplayTime,
    );
    return {
      idlePct: !activeSegment || activeSegment.status === 'idle' || activeSegment.status === 'repositioning' ? 100 : 0,
      pickupPct: activeSegment?.status === 'picking_up' ? 100 : 0,
      carryingPct: activeSegment?.status === 'carrying' ? 100 : 0,
    };
  }

  const idlePct = Math.round((durations.idle / total) * 100);
  const pickupPct = Math.round((durations.picking_up / total) * 100);
  return {
    idlePct,
    pickupPct,
    carryingPct: Math.max(0, 100 - idlePct - pickupPct),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function passengerUnitCount(passenger: Passenger): number {
  return isFiniteNumber(passenger.numPassengers) && passenger.numPassengers > 0
    ? passenger.numPassengers
    : 1;
}

function onboardPassengersForVehicle(frame: SimulationState, vehicleId: number): Passenger[] {
  const time = frame.metrics.currentTime;
  return frame.passengers.filter(passenger => {
    if (passenger.assignedVehicleId !== vehicleId) return false;
    if (passenger.status === 'cancelled') return false;
    if (passenger.pickupTime == null || passenger.pickupTime > time) return false;
    if (passenger.deliveryTime != null && passenger.deliveryTime <= time) return false;
    return true;
  });
}

function vehicleOnboardPassengerCount(
  vehicle: Vehicle | undefined,
  onboardPassengers: Passenger[],
): number {
  if (isFiniteNumber(vehicle?.numPassengers)) {
    return Math.max(0, vehicle.numPassengers);
  }

  return onboardPassengers.reduce((count, passenger) => count + passengerUnitCount(passenger), 0);
}

function onboardPassengerLabels(passengers: Passenger[]): string[] {
  return passengers.map(passenger => {
    const count = passengerUnitCount(passenger);
    return count > 1 ? 'P' + passenger.id + ' x' + count : 'P' + passenger.id;
  });
}

function onboardPassengerSignature(passengers: Passenger[]): string {
  return passengers
    .map(passenger => passenger.id + ':' + passengerUnitCount(passenger))
    .sort()
    .join('|');
}

function inferVehicleTimelineStatus(
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
  if (hasPickupTarget) return 'picking_up';

  return fallbackStatus;
}

export function useSimulationHistory() {
  const framesRef = useRef<SimulationState[]>([]);
  const vehicleIdSetRef = useRef(new Set<number>());

  const [frameCount, setFrameCount] = useState(0);
  const [hasHistory, setHasHistory] = useState(false);
  const [analysisVehicleId, setAnalysisVehicleId] = useState<number | null>(null);
  const [replayTime, setReplayTime] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);
  const [vehicleIds, setVehicleIds] = useState<number[]>([]);

  const addFrame = useCallback((state: SimulationState) => {
    const lastIndex = framesRef.current.length - 1;
    const lastFrame = lastIndex >= 0 ? framesRef.current[lastIndex] : null;
    if (lastFrame?.metrics.currentTime === state.metrics.currentTime) {
      framesRef.current[lastIndex] = state;
    } else {
      framesRef.current.push(state);
    }
    setHasHistory(true);
    for (const v of state.vehicles) {
      vehicleIdSetRef.current.add(v.id);
    }
    setVehicleIds(Array.from(vehicleIdSetRef.current).sort((a, b) => a - b));
    setFrameCount(c => c + 1);
  }, []);

  const clearHistory = useCallback(() => {
    framesRef.current = [];
    vehicleIdSetRef.current.clear();
    setFrameCount(0);
    setHasHistory(false);
    setAnalysisVehicleId(null);
    setVehicleIds([]);
    setReplayTime(0);
    setIsReplaying(false);
  }, []);

  const selectVehicle = useCallback((id: number | null) => {
    setAnalysisVehicleId(id);
    setReplayTime(0);
    setIsReplaying(false);
  }, []);

  const timeRange = useMemo(() => {
    if (framesRef.current.length === 0) return { min: 0, max: 0 };
    const times = framesRef.current.map(f => f.metrics.currentTime);
    return { min: 0, max: Math.max(...times) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameCount]);

  const buildReplayPayload = useCallback((
    config: SimulationConfigPayload,
    runName: string,
    maxTime?: number,
  ): SimulationReplayPayload | null => {
    const frames = maxTime == null
      ? [...framesRef.current]
      : framesRef.current.filter(frame => frame.metrics.currentTime <= maxTime);
    if (frames.length === 0) return null;

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      runName,
      config,
      frames,
    };
  }, []);

  const toggleReplay = useCallback(() => {
    setIsReplaying(prev => !prev);
  }, []);

  // Replay auto-advance
  useEffect(() => {
    if (!isReplaying) return;
    const id = setInterval(() => {
      setReplayTime(prev => {
        if (prev >= timeRange.max) {
          setIsReplaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, PLAYBACK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isReplaying, timeRange.max]);

  const analysis = useMemo((): VehicleAnalysis | null => {
    if (analysisVehicleId == null || framesRef.current.length === 0) return null;

    const frames = getOrderedFrames(framesRef.current);
    if (frames.length === 0) return null;

    const firstFrame = frames[0];
    const vid = analysisVehicleId;
    const replayFrame = frameAtOrBefore(frames, replayTime) ?? firstFrame;
    const replayFrames = frames.filter(
      frame => frame.metrics.currentTime <= replayFrame.metrics.currentTime,
    );
    const replayFramesForAnalysis = replayFrames.length > 0 ? replayFrames : [replayFrame];
    // --- Collect all passengers ever assigned to this vehicle ---
    const passengerMap = new Map<number, Passenger>();
    for (const frame of frames) {
      for (const p of frame.passengers) {
        if (p.assignedVehicleId === vid) {
          passengerMap.set(p.id, p);
        }
      }
    }
    const assignedPassengers = Array.from(passengerMap.values()).sort(
      (a, b) => a.requestTime - b.requestTime,
    );

    // --- Route edges & traversal counts (directional) ---
    const { routeEdges } = collectEdgeAnalysis(frames, vid);
    const { edgeTraversals } = collectEdgeAnalysis(replayFramesForAnalysis, vid);

    // --- Node activity (pickup / dropoff counts for this vehicle) ---
    const nodeActivityMap = new Map<number, NodeActivity>();
    const ensureNode = (nodeId: number) => {
      let a = nodeActivityMap.get(nodeId);
      if (!a) {
        a = { nodeId, pickupCount: 0, dropoffCount: 0 };
        nodeActivityMap.set(nodeId, a);
      }
      return a;
    };
    for (const p of assignedPassengers) {
      if (p.pickupTime != null) ensureNode(p.originNodeId).pickupCount += 1;
      if (p.deliveryTime != null) ensureNode(p.destinationNodeId).dropoffCount += 1;
    }
    const nodeActivity: NodeActivity[] = Array.from(nodeActivityMap.values());

    // --- Wait time data ---
    const waitTimeData: WaitTimeBarDatum[] = [];
    for (const p of assignedPassengers) {
      if (p.pickupTime != null) {
        waitTimeData.push({
          passengerId: p.id,
          waitTime: p.pickupTime - p.requestTime,
          requestTime: p.requestTime,
          pickupTime: p.pickupTime,
        });
      }
    }

    // --- Detour factor data ---
    const detourFactorData: DetourFactorDatum[] = [];
    for (const p of assignedPassengers) {
      if (p.pickupTime != null && p.deliveryTime != null) {
        const actualTravelTime = p.deliveryTime - p.pickupTime;
        const directTravelTime = (p.directTravelTime != null && p.directTravelTime > 0)
          ? p.directTravelTime
          : shortestTravelTime(p.originNodeId, p.destinationNodeId);
        if (directTravelTime != null && directTravelTime > 0) {
          const detourFactor = Math.round((actualTravelTime / directTravelTime) * 100) / 100;
          detourFactorData.push({
            passengerId: p.id,
            detourFactor: Math.max(1, detourFactor),
            actualTravelTime,
            directTravelTime,
            deliveryTime: p.deliveryTime,
          });
        }
      }
    }

    // --- Timeline and status share data ---
    const timelineData: VehicleTimelineDatum[] = [];
    let currentTimelineSegment: VehicleTimelineDatum | null = null;
    let currentPassengerSignature = '';
    let prevTime = -1;

    for (const frame of frames) {
      const v = frame.vehicles.find(veh => veh.id === vid);
      if (!v) continue;

      const t = frame.metrics.currentTime;
      if (t === prevTime) continue;
      prevTime = t;
      const status = inferVehicleTimelineStatus(frame, vid, v.status);
      const passengerSignature = onboardPassengerSignature(onboardPassengersForVehicle(frame, vid));

      if (!currentTimelineSegment) {
        currentPassengerSignature = passengerSignature;
        currentTimelineSegment = { startTime: 0, endTime: Math.max(0, t), status };
        timelineData.push(currentTimelineSegment);
      } else {
        const hasPassengerEvent = currentPassengerSignature !== passengerSignature;
        if (currentTimelineSegment.status !== status || hasPassengerEvent) {
          currentTimelineSegment.endTime = Math.max(currentTimelineSegment.endTime, t);
          currentTimelineSegment = {
            startTime: t,
            endTime: t,
            status,
            hasPassengerEvent,
          };
          currentPassengerSignature = passengerSignature;
          timelineData.push(currentTimelineSegment);
        } else {
          currentTimelineSegment.endTime = Math.max(currentTimelineSegment.endTime, t);
        }
      }
    }

    if (currentTimelineSegment) {
      currentTimelineSegment.endTime = Math.max(
        currentTimelineSegment.endTime,
        currentTimelineSegment.startTime + 1,
      );
    }

    const passengerLoadData: VehiclePassengerLoadDatum[] = [];
    let prevLoadTime = -1;
    for (const frame of frames) {
      const time = frame.metrics.currentTime;
      if (time === prevLoadTime) continue;
      prevLoadTime = time;
      const vehicle = frame.vehicles.find(veh => veh.id === vid);
      if (!vehicle) continue;
      const onboardPassengers = onboardPassengersForVehicle(frame, vid);
      passengerLoadData.push({
        time,
        onboardPassengers: vehicleOnboardPassengerCount(vehicle, onboardPassengers),
        onboardPassengerIds: onboardPassengers.map(passenger => passenger.id),
        onboardPassengerLabels: onboardPassengerLabels(onboardPassengers),
      });
    }

    const efficiencyData: EfficiencyDatum[] = frames
      .map(frame => frame.metrics.currentTime)
      .filter((time, index, times) => index === 0 || time !== times[index - 1])
      .map(time => ({
        time,
        ...calculateStatusShare(timelineData, time),
      }));
    const replayStatusShare = calculateStatusShare(timelineData, replayTime);

    // --- Snapshot at replay time (or earliest frame when replayTime is before first frame) ---
    const metrics: SimulationMetrics = replayFrame.metrics;

    // --- Vehicles & passengers snapshot at replay time ---
    const replayVehicles: Vehicle[] = replayFrame.vehicles;
    const replayPassengers: Passenger[] = replayFrame.passengers;
    const currentVehicle: Vehicle | null = replayFrame.vehicles.find(veh => veh.id === vid) ?? null;

    // --- Summary stats (up to replay time) ---
    const servedPassengers = assignedPassengers.filter(
      p => p.deliveryTime != null && p.deliveryTime <= replayTime,
    ).length;
    const cancelledPassengers = assignedPassengers.filter(
      p =>
        p.status === 'cancelled' &&
        (p.cancellationTime ?? p.requestTime) <= replayTime,
    ).length;
    const replayWaitData = waitTimeData.filter(w => w.pickupTime <= replayTime);
    const waitTimes = replayWaitData.map(w => w.waitTime);
    const avgWaitTime = waitTimes.length
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
      : 0;
    const maxWaitTime = waitTimes.length ? Math.max(...waitTimes) : 0;
    const replayDetourData = detourFactorData.filter(d => d.deliveryTime <= replayTime);
    const detours = replayDetourData.map(d => d.detourFactor);
    const avgDetourFactor = detours.length
      ? detours.reduce((a, b) => a + b, 0) / detours.length
      : 0;
    const replayVehicle = currentVehicle ?? replayVehicles.find(v => v.id === vid) ?? null;
    const totalDistance = replayVehicle?.totalDistance ?? 0;
    const totalTrips = replayVehicle?.totalTrips ?? 0;
    const totalAssigned = servedPassengers + cancelledPassengers;
    const summary: VehicleAnalysisSummary = {
      totalDistance,
      totalTrips,
      servedPassengers,
      cancelledPassengers,
      avgWaitTime: Math.round(avgWaitTime * 10) / 10,
      avgDetourFactor: Math.round(avgDetourFactor * 100) / 100,
      maxWaitTime: Math.round(maxWaitTime * 10) / 10,
      idlePct: replayStatusShare.idlePct,
      pickupPct: replayStatusShare.pickupPct,
      carryingPct: replayStatusShare.carryingPct,
      serviceRate: totalAssigned > 0 ? Math.round((servedPassengers / totalAssigned) * 1000) / 10 : 0,
      distancePerTrip: totalTrips > 0 ? Math.round((totalDistance / totalTrips) * 10) / 10 : 0,
    };

    return {
      vehicleId: vid,
      metrics,
      currentVehicle,
      replayVehicles,
      replayPassengers,
      assignedPassengers,
      routeEdges,
      edgeTraversals,
      nodeActivity,
      summary,
      waitTimeData,
      detourFactorData,
      efficiencyData,
      timelineData,
      passengerLoadData,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisVehicleId, frameCount, replayTime]);

  return {
    addFrame,
    clearHistory,
    hasHistory,
    analysisVehicleId,
    selectVehicle,
    vehicleIds,
    analysis,
    replayTime,
    setReplayTime,
    isReplaying,
    toggleReplay,
    timeRange,
    buildReplayPayload,
  };
}
