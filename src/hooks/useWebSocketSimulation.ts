import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { SimulationConfigPayload, SimulationState } from '../types/simulation';
import { getWsUrl, PLAYBACK_INTERVAL_MS } from '../config';

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
  requestStatusData: [],
  linkLoads: {},
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
  const [simFinished, setSimFinished] = useState(false);
  const [speed, setSpeedState] = useState(1);

  const bufferRef = useRef<SimulationState[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onFrameConsumedRef = useRef(options.onFrameConsumed);
  onFrameConsumedRef.current = options.onFrameConsumed;

  const stopPlayback = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const flushBuffer = useCallback(() => {
    stopPlayback();
    bufferRef.current = [];
  }, [stopPlayback]);

  const startPlayback = useCallback(() => {
    if (intervalRef.current !== null) return;
    intervalRef.current = setInterval(() => {
      const next = bufferRef.current.shift();
      if (next) {
        setState(next);
        onFrameConsumedRef.current?.(next);
      }
    }, PLAYBACK_INTERVAL_MS);
  }, []);

  useEffect(() => {
    const socket = io(getWsUrl(), {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      transports: ['polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      applyServerStateRef.current = false;
      flushBuffer();
      setState(SIMULATION_INITIAL_STATE);
      setIsRunning(false);
      setSimFinished(false);
      setConnectionStatus('connected');
      setReconnectAttempt(0);
    });

    socket.on('disconnect', () => {
      applyServerStateRef.current = false;
      flushBuffer();
      setState(SIMULATION_INITIAL_STATE);
      setIsRunning(false);
      setSimFinished(false);
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
      bufferRef.current.push(data);
    });

    socket.on('sim_done', () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      for (const frame of bufferRef.current) {
        onFrameConsumedRef.current?.(frame);
      }
      const last = bufferRef.current[bufferRef.current.length - 1];
      if (last) {
        setState(last);
      }
      bufferRef.current = [];
      setIsRunning(false);
      setSimFinished(true);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      flushBuffer();
    };
  }, [flushBuffer]);

  const sendCommand = useCallback((type: string, payload?: number) => {
    socketRef.current?.emit('command', { type, payload });
  }, []);

  const enterAnalysis = useCallback(() => {
    setSimFinished(false);
  }, []);

  const start = useCallback(() => {
    applyServerStateRef.current = true;
    sendCommand('start');
    setIsRunning(true);
    setSimFinished(false);
    startPlayback();
  }, [sendCommand, startPlayback]);

  const stop = useCallback(() => {
    sendCommand('stop');
    stopPlayback();
    for (const frame of bufferRef.current) {
      onFrameConsumedRef.current?.(frame);
    }
    const last = bufferRef.current[bufferRef.current.length - 1];
    if (last) {
      setState(last);
    }
    bufferRef.current = [];
    setIsRunning(false);
  }, [sendCommand, stopPlayback]);

  const reset = useCallback(() => {
    applyServerStateRef.current = false;
    flushBuffer();
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
    setSimFinished(false);
  }, [sendCommand, flushBuffer]);

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
    simFinished,
    speed,
    start,
    stop,
    reset,
    enterAnalysis,
    setSpeed,
  };
}
