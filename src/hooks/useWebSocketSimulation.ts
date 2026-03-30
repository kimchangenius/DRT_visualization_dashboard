import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { SimulationConfigPayload, SimulationState } from '../types/simulation';
import { getWsUrl, THROTTLE_MS } from '../config';

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
  vehicles: [],
  passengers: [],
  waitTimeDistribution: [],
  utilizationHistory: [],
  passengerHistory: [],
  tripStatusData: [],
  linkLoads: {},
};


export function useWebSocketSimulation() {
  const socketRef = useRef<Socket | null>(null);
  const applyServerStateRef = useRef(false);
  const [state, setState] = useState<SimulationState>(SIMULATION_INITIAL_STATE);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeedState] = useState(1);

  const lastUpdateRef = useRef(0);
  const pendingStateRef = useRef<SimulationState | null>(null);
  const rafIdRef = useRef<number | null>(null);

  const flushPendingState = useCallback(() => {
    rafIdRef.current = null;
    if (pendingStateRef.current) {
      setState(pendingStateRef.current);
      pendingStateRef.current = null;
    }
  }, []);

  const throttledSetState = useCallback((newState: SimulationState) => {
    const now = performance.now();
    if (now - lastUpdateRef.current >= THROTTLE_MS) {
      lastUpdateRef.current = now;
      setState(newState);
      pendingStateRef.current = null;
    } else {
      pendingStateRef.current = newState;
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(flushPendingState);
      }
    }
  }, [flushPendingState]);

  const clearPendingVisualUpdates = useCallback(() => {
    pendingStateRef.current = null;
    lastUpdateRef.current = 0;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    const socket = io(getWsUrl(), {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      // transports: ['websocket', 'polling'],
      transports: ['polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      applyServerStateRef.current = false;
      clearPendingVisualUpdates();
      setState(SIMULATION_INITIAL_STATE);
      setIsRunning(false);
      setConnectionStatus('connected');
      setReconnectAttempt(0);
    });

    socket.on('disconnect', () => {
      applyServerStateRef.current = false;
      clearPendingVisualUpdates();
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
      throttledSetState(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      clearPendingVisualUpdates();
    };
  }, [throttledSetState, clearPendingVisualUpdates]);

  const sendCommand = useCallback((type: string, payload?: number) => {
    socketRef.current?.emit('command', { type, payload });
  }, []);

  const start = useCallback(() => {
    applyServerStateRef.current = true;
    sendCommand('start');
    setIsRunning(true);
  }, [sendCommand]);

  const stop = useCallback(() => {
    sendCommand('stop');
    setIsRunning(false);
  }, [sendCommand]);

  const reset = useCallback(() => {
    applyServerStateRef.current = false;
    clearPendingVisualUpdates();
    setState(prev => ({
      ...SIMULATION_INITIAL_STATE,
      maxNumVehicles: prev.maxNumVehicles,
      vehCapacity: prev.vehCapacity,
      maxNumRequest: prev.maxNumRequest,
      maxWaitTime: prev.maxWaitTime,
      hiddenDim: prev.hiddenDim,
      batchSize: prev.batchSize,
      learningRate: prev.learningRate,
    }));
    sendCommand('reset');
    setIsRunning(false);
  }, [sendCommand, clearPendingVisualUpdates]);

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
    sendCommand('setSpeed', newSpeed);
  }, [sendCommand]);

  return {
    state,
    connected: connectionStatus === 'connected',
    connectionStatus,
    reconnectAttempt,
    isRunning,
    speed,
    start,
    stop,
    reset,
    setSpeed,
  };
}
