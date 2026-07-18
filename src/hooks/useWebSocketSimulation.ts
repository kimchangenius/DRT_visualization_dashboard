import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { DemandScenario, SimulationConfigPayload, SimulationState } from '../types/simulation';
import { getWsUrl } from '../config';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

export const SIMULATION_INITIAL_STATE: SimulationState = {
  metrics: {
    currentTime: 0,
    totalPassengersServed: 0,
    totalPassengersWaiting: 0,
    totalPassengersInTransit: 0,
    averageWaitTime: 0,
    averageTravelTime: 0,
    vehicleUtilization: 0,
    cancelCount: 0,
    activeVehicles: 0,
    totalVehicles: 0,
  },
  maxNumVehicles: 0,
  vehCapacity: 0,
  maxNumRequest: 0,
  maxWaitTime: 0,
  hiddenDim: 0,
  batchSize: 0,
  learningRate: 0,
  selectedScenario: 'S1',
  availableScenarios: ['S1', 'S2', 'S3', 'S4'],
  scenarioSeed: 0,
  modelWeightFile: null,
  vehicles: [],
  passengers: [],
  utilizationHistory: [],
  passengerHistory: [],
  requestStatusData: [],
};


export interface WebSocketSimulationOptions {
  onFrameConsumed?: (state: SimulationState) => void;
}

export function useWebSocketSimulation(options: WebSocketSimulationOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const applyServerStateRef = useRef(false);
  const [state, setState] = useState<SimulationState>(SIMULATION_INITIAL_STATE);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const onFrameConsumedRef = useRef(options.onFrameConsumed);
  onFrameConsumedRef.current = options.onFrameConsumed;

  const completeServerDone = useCallback(() => {
    applyServerStateRef.current = false;
    setIsRunning(false);
  }, []);

  useEffect(() => {
    const socket = io(getWsUrl(), {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      applyServerStateRef.current = false;
      setState(SIMULATION_INITIAL_STATE);
      setIsRunning(false);
      setConnectionStatus('connected');
      setReconnectAttempt(0);
    });

    socket.on('disconnect', () => {
      applyServerStateRef.current = false;
      setState(SIMULATION_INITIAL_STATE);
      setIsRunning(false);
      setConnectionStatus('disconnected');
    });

    socket.io.on('reconnect_attempt', (attempt) => {
      setConnectionStatus('reconnecting');
      setReconnectAttempt(attempt);
    });

    socket.io.on('reconnect', () => {
      setConnectionStatus('connected');
      setReconnectAttempt(0);
    });

    socket.io.on('reconnect_failed', () => {
      setConnectionStatus('disconnected');
    });

    socket.on('sim_meta', (payload: SimulationConfigPayload) => {
      setState(prev => ({
        ...prev,
        ...payload,
      }));
    });

    socket.on('state', (data: SimulationState) => {
      if (!applyServerStateRef.current) return;
      setState(data);
      onFrameConsumedRef.current?.(data);
    });

    socket.on('sim_done', () => {
      completeServerDone();
    });

    socket.on('sim_error', () => {
      completeServerDone();
    });

    socket.on('command_error', () => {
      completeServerDone();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      applyServerStateRef.current = false;
    };
  }, [completeServerDone]);

  const sendCommand = useCallback((type: string, payload?: DemandScenario) => {
    socketRef.current?.emit('command', { type, payload });
  }, []);

  const enterAnalysis = useCallback(() => {
    applyServerStateRef.current = false;
  }, []);

  const start = useCallback((scenario?: DemandScenario) => {
    applyServerStateRef.current = true;
    sendCommand('start', scenario);
    setIsRunning(true);
  }, [sendCommand]);

  const stop = useCallback(() => {
    sendCommand('stop');
    applyServerStateRef.current = false;
    setIsRunning(false);
  }, [sendCommand]);

  const reset = useCallback((scenario?: DemandScenario) => {
    applyServerStateRef.current = false;
    setState(prev => ({
      ...SIMULATION_INITIAL_STATE,
      maxNumVehicles: prev.maxNumVehicles,
      vehCapacity: prev.vehCapacity,
      maxNumRequest: prev.maxNumRequest,
      maxWaitTime: prev.maxWaitTime,
      hiddenDim: prev.hiddenDim,
      batchSize: prev.batchSize,
      learningRate: prev.learningRate,
      selectedScenario: scenario ?? prev.selectedScenario,
      availableScenarios: prev.availableScenarios,
      scenarioSeed: prev.scenarioSeed,
      modelWeightFile: prev.modelWeightFile,
    }));
    sendCommand('reset', scenario);
    setIsRunning(false);
  }, [sendCommand]);

  const setScenario = useCallback((scenario: DemandScenario) => {
    applyServerStateRef.current = false;
    setState(prev => ({
      ...SIMULATION_INITIAL_STATE,
      maxNumVehicles: prev.maxNumVehicles,
      vehCapacity: prev.vehCapacity,
      maxNumRequest: prev.maxNumRequest,
      maxWaitTime: prev.maxWaitTime,
      hiddenDim: prev.hiddenDim,
      batchSize: prev.batchSize,
      learningRate: prev.learningRate,
      selectedScenario: scenario,
      availableScenarios: prev.availableScenarios,
      scenarioSeed: prev.scenarioSeed,
      modelWeightFile: prev.modelWeightFile,
    }));
    sendCommand('setScenario', scenario);
    setIsRunning(false);
  }, [sendCommand]);

  return {
    state,
    connectionStatus,
    reconnectAttempt,
    isRunning,
    start,
    stop,
    reset,
    setScenario,
    enterAnalysis,
  };
}
