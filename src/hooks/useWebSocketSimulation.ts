import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { SimulationState } from '../types/simulation';
import { WS_URL, THROTTLE_MS } from '../config';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting';

const INITIAL_STATE: SimulationState = {
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
  const [state, setState] = useState<SimulationState>(INITIAL_STATE);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [vehicleCount, setVehicleCountState] = useState(4);

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

  useEffect(() => {
    const socket = io(WS_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      // transports: ['websocket', 'polling'],
      transports: ['polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('connected');
      setReconnectAttempt(0);
    });

    socket.on('disconnect', () => {
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

    socket.on('state', (data: SimulationState) => {
      throttledSetState(data);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [throttledSetState]);

  const sendCommand = useCallback((type: string, payload?: number) => {
    socketRef.current?.emit('command', { type, payload });
  }, []);

  const start = useCallback(() => {
    sendCommand('start');
    setIsRunning(true);
  }, [sendCommand]);

  const stop = useCallback(() => {
    sendCommand('stop');
    setIsRunning(false);
  }, [sendCommand]);

  const reset = useCallback(() => {
    sendCommand('reset', vehicleCount);
    setIsRunning(false);
  }, [sendCommand, vehicleCount]);

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
    sendCommand('setSpeed', newSpeed);
  }, [sendCommand]);

  const setVehicleCount = useCallback((count: number) => {
    setVehicleCountState(count);
    sendCommand('setVehicleCount', count);
  }, [sendCommand]);

  return {
    state,
    connected: connectionStatus === 'connected',
    connectionStatus,
    reconnectAttempt,
    isRunning,
    speed,
    vehicleCount,
    start,
    stop,
    reset,
    setSpeed,
    setVehicleCount,
  };
}
