import { useCallback, useMemo } from 'react';
import { useWebSocketSimulation } from './hooks/useWebSocketSimulation';
import { useSimulationHistory } from './hooks/useSimulationHistory';
import Header from './components/Header';
import SimulationControls from './components/SimulationControls';
import NetworkMap from './components/NetworkMap';
import MetricsPanel from './components/MetricsPanel';
import RequestInformation from './components/RequestInformation';
import VehicleUtilChart from './components/VehicleUtilChart';
import PassengerChart from './components/PassengerChart';
import RequestStatusChart from './components/RequestStatusChart';
import WaitTimeBarChart from './components/WaitTimeBarChart';
import DetourFactorChart from './components/DetourFactorChart';
import OperationalEfficiencyChart from './components/OperationalEfficiencyChart';
import './App.css';

export default function App() {
  const history = useSimulationHistory();

  const onFrameConsumed = useCallback(
    (s: Parameters<typeof history.addFrame>[0]) => history.addFrame(s),
    [history.addFrame],
  );

  const {
    state,
    connectionStatus,
    reconnectAttempt,
    isRunning,
    simFinished,
    speed,
    start,
    stop,
    reset: wsReset,
    enterAnalysis,
  } = useWebSocketSimulation({ onFrameConsumed });

  const reset = useCallback(() => {
    history.clearHistory();
    wsReset();
  }, [history.clearHistory, wsReset]);

  const handleEnterAnalysis = useCallback(() => {
    enterAnalysis();
    history.setReplayTime(0);
  }, [enterAnalysis, history.setReplayTime]);

  // Sim finished but user hasn't clicked "Enter Analysis Mode" yet
  const canEnterAnalysis = simFinished && history.hasHistory;

  // User has entered analysis mode (clicked the button)
  const inAnalysisMode = !isRunning && !simFinished && history.hasHistory;

  // User has entered analysis mode AND selected a vehicle
  const analysisActive = inAnalysisMode && history.analysisVehicleId != null;

  const analysisVehicles = useMemo(() => {
    if (!analysisActive || !history.analysis?.currentVehicle) return state.vehicles;
    return state.vehicles;
  }, [analysisActive, history.analysis, state.vehicles]);

  const metrics = analysisActive && history.analysis
    ? history.analysis.metrics
    : state.metrics;

  const passengers = analysisActive && history.analysis
    ? history.analysis.assignedPassengers
    : state.passengers;

  const currentTime = analysisActive
    ? history.replayTime
    : state.metrics.currentTime;

  return (
    <div className="app">
      <div className="dashboard-layout">
        <div className="dashboard-layout-left">
          <div className="dashboard-left-top">
            <div className="dashboard-left-top-row">
              <Header
                currentTime={currentTime}
                connectionStatus={connectionStatus}
                reconnectAttempt={reconnectAttempt}
              />
              <MetricsPanel metrics={metrics} />
            </div>
          </div>

          <div className="dashboard-left-body">
            <aside className="dashboard-left-controls">
              <SimulationControls
                isRunning={isRunning}
                speed={speed}
                maxNumVehicles={state.maxNumVehicles}
                vehCapacity={state.vehCapacity}
                maxNumRequest={state.maxNumRequest}
                maxWaitTime={state.maxWaitTime}
                hiddenDim={state.hiddenDim}
                batchSize={state.batchSize}
                learningRate={state.learningRate}
                vehicles={state.vehicles}
                passengers={state.passengers}
                onStart={start}
                onStop={stop}
                onReset={reset}
                canEnterAnalysis={canEnterAnalysis}
                inAnalysisMode={inAnalysisMode}
                onEnterAnalysis={handleEnterAnalysis}
                analysisVehicleId={history.analysisVehicleId}
                analysisVehicleIds={history.vehicleIds}
                onSelectAnalysisVehicle={history.selectVehicle}
                replayTime={history.replayTime}
                onReplayTimeChange={history.setReplayTime}
                isReplaying={history.isReplaying}
                onToggleReplay={history.toggleReplay}
                timeRange={history.timeRange}
              />
            </aside>

            <section className="dashboard-left-map">
              <NetworkMap
                vehicles={analysisVehicles}
                passengers={analysisActive ? [] : state.passengers}
                analysisVehicleId={analysisActive ? history.analysisVehicleId : undefined}
                routeEdges={analysisActive ? history.analysis?.routeEdges : undefined}
                analysisPassengers={analysisActive ? history.analysis?.assignedPassengers : undefined}
                edgeTraversals={analysisActive ? history.analysis?.edgeTraversals : undefined}
                nodeActivity={analysisActive ? history.analysis?.nodeActivity : undefined}
                analysisSummary={analysisActive ? history.analysis?.summary : undefined}
                maxWaitTimeThreshold={state.maxWaitTime}
              />
            </section>
          </div>
        </div>

        <aside className="dashboard-layout-right">
          <RequestInformation passengers={passengers} currentTime={currentTime} />
          {analysisActive && history.analysis ? (
            <>
              <WaitTimeBarChart
                data={history.analysis.waitTimeData}
                maxWaitTime={state.maxWaitTime}
              />
              <DetourFactorChart data={history.analysis.detourFactorData} />
              <OperationalEfficiencyChart data={history.analysis.efficiencyData} />
            </>
          ) : (
            <>
              <VehicleUtilChart data={state.utilizationHistory} />
              <PassengerChart data={state.passengerHistory} />
              <RequestStatusChart data={state.requestStatusData} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
