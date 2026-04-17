import { useCallback, useState } from 'react';

import { useWebSocketSimulation } from './hooks/useWebSocketSimulation';
import { useSimulationHistory } from './hooks/useSimulationHistory';
import Header from './components/Header';
import SimulationControls from './components/SimulationControls';
import NetworkMap from './components/NetworkMap';
import MetricsPanel from './components/MetricsPanel';
import RequestInformation from './components/RequestInformation';
import VehicleRequestOperation from './components/VehicleRequestOperation';
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

  const [analysisEntered, setAnalysisEntered] = useState(false);

  const {
    state,
    connectionStatus,
    reconnectAttempt,
    isRunning,
    speed,
    start,
    stop,
    reset: wsReset,
    enterAnalysis,
  } = useWebSocketSimulation({ onFrameConsumed });

  const handleStart = useCallback(() => {
    setAnalysisEntered(false);
    start();
  }, [start]);

  const reset = useCallback(() => {
    history.clearHistory();
    wsReset();
    setAnalysisEntered(false);
  }, [history.clearHistory, wsReset]);

  const handleEnterAnalysis = useCallback(() => {
    enterAnalysis();
    setAnalysisEntered(true);
    history.setReplayTime(0);
  }, [enterAnalysis, history.setReplayTime]);

  // Analysis 버튼 활성: 시뮬레이션 멈춰있고 히스토리 있고 아직 분석모드 미진입
  const canEnterAnalysis = !isRunning && history.hasHistory && !analysisEntered;

  // 분석모드: 버튼을 명시적으로 눌렀을 때만
  const inAnalysisMode = analysisEntered && history.hasHistory;

  // User has entered analysis mode AND selected a vehicle
  const analysisActive = inAnalysisMode && history.analysisVehicleId != null;

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
                onStart={handleStart}
                onStop={stop}
                onReset={reset}
                canEnterAnalysis={canEnterAnalysis}
                inAnalysisMode={inAnalysisMode}
                onEnterAnalysis={handleEnterAnalysis}
                analysisVehicleId={history.analysisVehicleId}
                analysisVehicleIds={history.vehicleIds}
                onSelectAnalysisVehicle={history.selectVehicle}
                analysisCurrentVehicle={history.analysis?.currentVehicle}
                analysisPassengers={history.analysis?.assignedPassengers}
                replayTime={history.replayTime}
                onReplayTimeChange={history.setReplayTime}
                isReplaying={history.isReplaying}
                onToggleReplay={history.toggleReplay}
                timeRange={history.timeRange}
                vehicles={state.vehicles}
                passengers={state.passengers}
                analysisSummary={analysisActive ? history.analysis?.summary : undefined}
                maxWaitTimeThreshold={state.maxWaitTime}
              />
            </aside>

            <section className="dashboard-left-map">
              <NetworkMap
                vehicles={analysisActive && history.analysis?.replayVehicles
                  ? history.analysis.replayVehicles
                  : state.vehicles}
                passengers={analysisActive && history.analysis?.replayPassengers
                  ? history.analysis.replayPassengers
                  : state.passengers}
                analysisVehicleId={analysisActive ? history.analysisVehicleId : undefined}
                edgeTraversals={analysisActive ? history.analysis?.edgeTraversals : undefined}
                // nodeActivity={analysisActive ? history.analysis?.nodeActivity : undefined}  // Activity ring – disabled
                maxWaitTimeThreshold={state.maxWaitTime}
              />
            </section>
          </div>
        </div>

        <aside className="dashboard-layout-right">
          {analysisActive && history.analysis ? (
            <VehicleRequestOperation
              vehicleId={history.analysisVehicleId!}
              assignedPassengers={history.analysis.assignedPassengers}
              replayTime={history.replayTime}
            />
          ) : (
            <RequestInformation passengers={passengers} currentTime={currentTime} />
          )}
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
