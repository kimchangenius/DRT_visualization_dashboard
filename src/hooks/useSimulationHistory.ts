import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SimulationState,
  SimulationMetrics,
  Passenger,
  Vehicle,
  VehicleAnalysis,
  VehicleAnalysisSummary,
  EdgeTraversal,
  NodeActivity,
  WaitTimeBarDatum,
  DetourFactorDatum,
  EfficiencyDatum,
} from '../types/simulation';
import { shortestTravelTime } from '../data/siouxFallsNetwork';
import { PLAYBACK_INTERVAL_MS } from '../config';

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
    framesRef.current.push(state);
    if (!hasHistory) setHasHistory(true);
    for (const v of state.vehicles) {
      vehicleIdSetRef.current.add(v.id);
    }
    setVehicleIds(Array.from(vehicleIdSetRef.current).sort((a, b) => a - b));
    setFrameCount(c => c + 1);
  }, [hasHistory]);

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
    return { min: Math.min(...times), max: Math.max(...times) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameCount]);

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

    const frames = framesRef.current;
    const firstFrame = frames[0];
    const vid = analysisVehicleId;
    const lastFrame = frames[frames.length - 1];

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
    const edgeSet = new Set<string>();
    const routeEdges: [number, number][] = [];
    const edgeCountMap = new Map<string, EdgeTraversal>();
    let lastPathSig = '';
    for (const frame of frames) {
      const v = frame.vehicles.find(veh => veh.id === vid);
      if (!v || v.path.length < 2) continue;
      const pathSig = `${frame.metrics.currentTime}-${v.path.join('|')}`;
      // Count traversals only when path signature (per time) changes,
      // so repeated frames of the same path don't inflate counts.
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
    const edgeTraversals: EdgeTraversal[] = Array.from(edgeCountMap.values());

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
        });
      }
    }

    // --- Detour factor data ---
    const detourFactorData: DetourFactorDatum[] = [];
    for (const p of assignedPassengers) {
      if (p.pickupTime != null && p.deliveryTime != null) {
        const actualTravelTime = p.deliveryTime - p.pickupTime;
        const directTravelTime = shortestTravelTime(p.originNodeId, p.destinationNodeId);
        if (directTravelTime != null && directTravelTime > 0) {
          detourFactorData.push({
            passengerId: p.id,
            detourFactor: Math.round((actualTravelTime / directTravelTime) * 100) / 100,
            actualTravelTime,
            directTravelTime,
          });
        }
      }
    }

    // --- Efficiency data (cumulative status breakdown per frame) ---
    const statusCounts = { idle: 0, picking_up: 0, carrying: 0 };
    const efficiencyData: EfficiencyDatum[] = [];
    let prevTime = -1;
    for (const frame of frames) {
      const v = frame.vehicles.find(veh => veh.id === vid);
      if (!v) continue;
      const t = frame.metrics.currentTime;
      if (t === prevTime) continue;
      prevTime = t;

      if (v.status === 'idle') statusCounts.idle++;
      else if (v.status === 'picking_up') statusCounts.picking_up++;
      else if (v.status === 'carrying') statusCounts.carrying++;
      else statusCounts.idle++;

      const total = statusCounts.idle + statusCounts.picking_up + statusCounts.carrying;
      if (total > 0) {
        const idlePct = Math.round((statusCounts.idle / total) * 100);
        const pickupPct = Math.round((statusCounts.picking_up / total) * 100);
        const carryingPct = 100 - idlePct - pickupPct;
        efficiencyData.push({ time: t, idlePct, pickupPct, carryingPct });
      }
    }

    // --- Snapshot at replay time (or earliest frame when replayTime is before first frame) ---
    let metricsFrame = firstFrame;
    for (const frame of frames) {
      if (frame.metrics.currentTime <= replayTime) {
        metricsFrame = frame;
      } else {
        break;
      }
    }
    const metrics: SimulationMetrics = metricsFrame.metrics;

    // --- Vehicles & passengers snapshot at replay time ---
    let replayVehicles: Vehicle[] = firstFrame.vehicles;
    let replayPassengers: Passenger[] = firstFrame.passengers;
    let currentVehicle: Vehicle | null = firstFrame.vehicles.find(veh => veh.id === vid) ?? null;
    for (const frame of frames) {
      if (frame.metrics.currentTime <= replayTime) {
        replayVehicles = frame.vehicles;
        replayPassengers = frame.passengers;
        currentVehicle = frame.vehicles.find(veh => veh.id === vid) ?? null;
      } else {
        break;
      }
    }

    // --- Summary stats ---
    const servedPassengers = assignedPassengers.filter(p => p.deliveryTime != null).length;
    const cancelledPassengers = assignedPassengers.filter(p => p.status === 'cancelled').length;
    const waitTimes = waitTimeData.map(w => w.waitTime);
    const avgWaitTime = waitTimes.length
      ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
      : 0;
    const maxWaitTime = waitTimes.length ? Math.max(...waitTimes) : 0;
    const detours = detourFactorData.map(d => d.detourFactor);
    const avgDetourFactor = detours.length
      ? detours.reduce((a, b) => a + b, 0) / detours.length
      : 0;
    const lastEff = efficiencyData[efficiencyData.length - 1];
    const totalDistance = currentVehicle?.totalDistance ?? lastFrame.vehicles.find(v => v.id === vid)?.totalDistance ?? 0;
    const totalTrips = currentVehicle?.totalTrips ?? lastFrame.vehicles.find(v => v.id === vid)?.totalTrips ?? 0;
    const totalAssigned = servedPassengers + cancelledPassengers;
    const summary: VehicleAnalysisSummary = {
      totalDistance,
      totalTrips,
      servedPassengers,
      cancelledPassengers,
      avgWaitTime: Math.round(avgWaitTime * 10) / 10,
      avgDetourFactor: Math.round(avgDetourFactor * 100) / 100,
      maxWaitTime: Math.round(maxWaitTime * 10) / 10,
      idlePct: lastEff?.idlePct ?? 0,
      pickupPct: lastEff?.pickupPct ?? 0,
      carryingPct: lastEff?.carryingPct ?? 0,
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
  };
}
