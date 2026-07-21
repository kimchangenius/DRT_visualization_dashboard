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
  WaitTimeBarDatum,
  DetourFactorDatum,
  VehicleTimelineDatum,
  ReplayDispatchDecision,
  ReplayVehicleMovement,
} from '../types/simulation';
import { shortestTravelTime } from '../data/siouxFallsNetwork';
import { PLAYBACK_INTERVAL_MS } from '../config';
import { compactReplayFrame, frameAtOrBefore } from '../utils/replay';
import { routeNodeIdsForVehicle } from '../utils/networkGeometry';
import {
  buildVehiclePassengerLoadData,
  buildVehicleTimelineData,
  encodePassengerEvents,
  latestPassengersEverAssignedToVehicle,
  orderedUniqueFrames,
  passengerUnitCount,
} from '../utils/vehicleTemporal';

type StatusShare = Pick<VehicleAnalysisSummary, 'idlePct' | 'pickupPct' | 'carryingPct'>;

function movementIdentity(movement: ReplayVehicleMovement): string {
  return [
    movement.vehicleId,
    movement.requestId,
    movement.movementType,
    movement.startTime,
  ].join(':');
}

function dispatchDecisionIdentity(decision: ReplayDispatchDecision): string {
  return [
    decision.time,
    decision.decisionRound,
    decision.vehicleId,
  ].join(':');
}

function collectEdgeTraversals(frames: SimulationState[], vehicleId: number): EdgeTraversal[] {
  const edgeCountMap = new Map<string, EdgeTraversal>();
  let lastPathSig = '';

  for (const frame of frames) {
    const v = frame.vehicles.find(veh => veh.id === vehicleId);
    if (!v || v.path.length < 2) {
      lastPathSig = '';
      continue;
    }

    const route = routeNodeIdsForVehicle(v);
    if (route.length < 2) {
      lastPathSig = '';
      continue;
    }
    const pathSig = `${route.join('|')}-${v.status}`;
    if (pathSig === lastPathSig) continue;
    lastPathSig = pathSig;

    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      const key = `${a}-${b}`;
      const existing = edgeCountMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        edgeCountMap.set(key, { from: a, to: b, count: 1 });
      }
    }
  }

  return Array.from(edgeCountMap.values());
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
      idlePct: !activeSegment || activeSegment.status === 'idle' ? 100 : 0,
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

export function useSimulationHistory() {
  const framesRef = useRef<SimulationState[]>([]);
  const vehicleIdSetRef = useRef(new Set<number>());
  const movementMapRef = useRef(new Map<string, ReplayVehicleMovement>());
  const dispatchDecisionMapRef = useRef(new Map<string, ReplayDispatchDecision>());

  const [frameCount, setFrameCount] = useState(0);
  const [hasHistory, setHasHistory] = useState(false);
  const [analysisVehicleId, setAnalysisVehicleId] = useState<number | null>(null);
  const [replayTime, setReplayTime] = useState(0);
  const [isReplaying, setIsReplaying] = useState(false);
  const [vehicleIds, setVehicleIds] = useState<number[]>([]);

  const addFrame = useCallback((state: SimulationState) => {
    for (const movement of state.vehicleMovementEvents ?? []) {
      movementMapRef.current.set(movementIdentity(movement), movement);
    }
    for (const decision of state.dispatchDecisionEvents ?? []) {
      dispatchDecisionMapRef.current.set(dispatchDecisionIdentity(decision), decision);
    }
    const historyFrame = compactReplayFrame(state);
    const lastIndex = framesRef.current.length - 1;
    const lastFrame = lastIndex >= 0 ? framesRef.current[lastIndex] : null;
    if (lastFrame?.metrics.currentTime === state.metrics.currentTime) {
      framesRef.current[lastIndex] = historyFrame;
    } else {
      framesRef.current.push(historyFrame);
    }
    setHasHistory(true);
    let vehicleIdsChanged = false;
    for (const v of state.vehicles) {
      if (!vehicleIdSetRef.current.has(v.id)) vehicleIdsChanged = true;
      vehicleIdSetRef.current.add(v.id);
    }
    if (vehicleIdsChanged) {
      setVehicleIds(Array.from(vehicleIdSetRef.current).sort((a, b) => a - b));
    }
    setFrameCount(c => c + 1);
  }, []);

  const clearHistory = useCallback(() => {
    framesRef.current = [];
    vehicleIdSetRef.current.clear();
    movementMapRef.current.clear();
    dispatchDecisionMapRef.current.clear();
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
    let max = 0;
    for (const frame of framesRef.current) {
      max = Math.max(max, frame.metrics.currentTime);
    }
    return { min: 0, max };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameCount]);

  const buildReplayPayload = useCallback((
    config: SimulationConfigPayload,
    runName: string,
    maxTime?: number,
  ): SimulationReplayPayload | null => {
    const uniqueFrames = orderedUniqueFrames(maxTime == null
      ? [...framesRef.current]
      : framesRef.current.filter(frame => frame.metrics.currentTime <= maxTime));
    if (uniqueFrames.length === 0) return null;
    const passengerEvents = encodePassengerEvents(uniqueFrames);
    const frames = uniqueFrames.map(compactReplayFrame);
    const vehicleMovements = [...movementMapRef.current.values()]
      .filter(movement => maxTime == null || movement.endTime <= maxTime)
      .sort(
        (left, right) =>
          left.startTime - right.startTime ||
          left.vehicleId - right.vehicleId ||
          left.requestId - right.requestId,
      );
    const dispatchDecisions = [...dispatchDecisionMapRef.current.values()]
      .filter(decision => maxTime == null || decision.time <= maxTime)
      .sort(
        (left, right) =>
          left.time - right.time ||
          left.decisionRound - right.decisionRound ||
          left.vehicleId - right.vehicleId,
      );

    return {
      version: 4,
      generatedAt: new Date().toISOString(),
      runName,
      config,
      frames,
      passengerEvents,
      distanceUnit: 'network_distance_unit',
      vehicleMovements,
      dispatchDecisions,
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

  const analysisBase = useMemo(() => {
    if (analysisVehicleId == null || framesRef.current.length === 0) return null;

    const frames = orderedUniqueFrames(framesRef.current);
    if (frames.length === 0) return null;

    const vid = analysisVehicleId;
    // --- Collect all passengers ever assigned to this vehicle ---
    const assignedPassengers = latestPassengersEverAssignedToVehicle(frames, vid);

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
    const timelineData: VehicleTimelineDatum[] = buildVehicleTimelineData(frames, vid);
    const passengerLoadData = buildVehiclePassengerLoadData(frames, vid);

    return {
      frames,
      vid,
      assignedPassengers,
      waitTimeData,
      detourFactorData,
      timelineData,
      passengerLoadData,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisVehicleId, frameCount]);

  const analysis = useMemo((): VehicleAnalysis | null => {
    if (!analysisBase) return null;

    const {
      frames,
      vid,
      assignedPassengers,
      waitTimeData,
      detourFactorData,
      timelineData,
      passengerLoadData,
    } = analysisBase;
    const firstFrame = frames[0];
    const replayFrame = frameAtOrBefore(frames, replayTime) ?? firstFrame;
    const replayFrameIndex = frames.indexOf(replayFrame);
    const replayFramesForAnalysis = frames.slice(0, replayFrameIndex + 1);

    // --- Route edges & traversal counts (directional) ---
    const edgeTraversals = collectEdgeTraversals(replayFramesForAnalysis, vid);

    // --- Node activity (pickup / dropoff counts for this vehicle) ---
    // Activity ring is disabled, so its unused aggregate is not computed.

    const replayStatusShare = calculateStatusShare(timelineData, replayTime);

    // --- Snapshot at replay time (or earliest frame when replayTime is before first frame) ---
    const metrics: SimulationMetrics = replayFrame.metrics;

    // --- Vehicles & passengers snapshot at replay time ---
    const replayVehicles: Vehicle[] = replayFrame.vehicles;
    const replayPassengers: Passenger[] = replayFrame.passengers;
    const currentVehicle: Vehicle | null = replayFrame.vehicles.find(veh => veh.id === vid) ?? null;

    // --- Summary stats (up to replay time) ---
    const servedPassengers = assignedPassengers.reduce(
      (total, passenger) =>
        passenger.deliveryTime != null && passenger.deliveryTime <= replayTime
          ? total + passengerUnitCount(passenger)
          : total,
      0,
    );
    const cancelledPassengers = assignedPassengers.reduce(
      (total, passenger) =>
        passenger.status === 'cancelled' &&
        (passenger.cancellationTime ?? passenger.requestTime) <= replayTime
          ? total + passengerUnitCount(passenger)
          : total,
      0,
    );
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
      edgeTraversals,
      summary,
      waitTimeData,
      detourFactorData,
      timelineData,
      passengerLoadData,
    };
  }, [analysisBase, replayTime]);

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
