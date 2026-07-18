import { lazy, memo, Suspense, useCallback, useEffect, useState } from 'react';

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
import VehicleTimelineChart from './components/VehicleTimelineChart';
import type { DemandScenario, SimulationConfigPayload } from './types/simulation';
import { saveReplayJson } from './utils/saveReplay';
import './App.css';

type AppTab = 'dashboard' | 'compare' | 'analysis';

const ResultCompare = memo(lazy(() => import('./components/ResultCompare')));
const ResultAnalysis = memo(lazy(() => import('./components/ResultAnalysis')));

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard');
  const [visitedTabs, setVisitedTabs] = useState<Set<AppTab>>(
    () => new Set<AppTab>(['dashboard']),
  );
  const history = useSimulationHistory();

  const onFrameConsumed = useCallback(
    (s: Parameters<typeof history.addFrame>[0]) => history.addFrame(s),
    [history.addFrame],
  );

  const [analysisEntered, setAnalysisEntered] = useState(false);
  const [scenarioSelectionLocked, setScenarioSelectionLocked] = useState(false);
  const [isSavingReplay, setIsSavingReplay] = useState(false);

  const {
    state,
    connectionStatus,
    reconnectAttempt,
    isRunning,
    start,
    stop,
    reset: wsReset,
    setScenario,
    enterAnalysis,
  } = useWebSocketSimulation({ onFrameConsumed });

  const handleStart = useCallback(() => {
    if (connectionStatus !== 'connected') return;
    setScenarioSelectionLocked(true);
    setAnalysisEntered(false);
    start(state.selectedScenario);
  }, [connectionStatus, start, state.selectedScenario]);

  const reset = useCallback(() => {
    history.clearHistory();
    wsReset(state.selectedScenario);
    setAnalysisEntered(false);
    setScenarioSelectionLocked(false);
  }, [history.clearHistory, wsReset, state.selectedScenario]);

  const handleScenarioChange = useCallback((scenario: DemandScenario) => {
    if (scenarioSelectionLocked) return;
    history.clearHistory();
    setScenario(scenario);
    setAnalysisEntered(false);
  }, [history.clearHistory, scenarioSelectionLocked, setScenario]);

  const handleEnterAnalysis = useCallback(() => {
    enterAnalysis();
    setAnalysisEntered(true);
    history.setReplayTime(0);
  }, [enterAnalysis, history.setReplayTime]);

  const handleTabChange = useCallback((tab: AppTab) => {
    setActiveTab(tab);
    setVisitedTabs(previous => {
      if (previous.has(tab)) return previous;
      const next = new Set(previous);
      next.add(tab);
      return next;
    });
  }, []);

  const handleSaveReplay = useCallback(async () => {
    const config: SimulationConfigPayload = {
      maxNumVehicles: state.maxNumVehicles,
      vehCapacity: state.vehCapacity,
      maxNumRequest: state.maxNumRequest,
      maxWaitTime: state.maxWaitTime,
      hiddenDim: state.hiddenDim,
      batchSize: state.batchSize,
      learningRate: state.learningRate,
      selectedScenario: state.selectedScenario,
      availableScenarios: state.availableScenarios,
      scenarioSeed: state.scenarioSeed,
      modelWeightFile: state.modelWeightFile,
    };
    const payload = history.buildReplayPayload(
      config,
      `live_${state.selectedScenario}_seed${state.scenarioSeed}_t${state.metrics.currentTime}`,
      state.metrics.currentTime,
    );
    if (!payload) return;

    setIsSavingReplay(true);
    try {
      await saveReplayJson(payload, `replay_${state.selectedScenario}.json`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.error('Failed to save replay JSON.', error);
      }
    } finally {
      setIsSavingReplay(false);
    }
  }, [
    history.buildReplayPayload,
    state.availableScenarios,
    state.batchSize,
    state.hiddenDim,
    state.learningRate,
    state.maxNumRequest,
    state.maxNumVehicles,
    state.maxWaitTime,
    state.metrics.currentTime,
    state.modelWeightFile,
    state.scenarioSeed,
    state.selectedScenario,
    state.vehCapacity,
  ]);

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

  useEffect(() => {
    document.body.classList.toggle('is-result-analysis-view', activeTab === 'analysis');
    return () => document.body.classList.remove('is-result-analysis-view');
  }, [activeTab]);

  return (
    <div className={`app${activeTab === 'analysis' ? ' is-result-analysis' : ''}`}>
      <nav className="app-tabs" aria-label="Dashboard sections">
        <button
          type="button"
          className={`app-tab${activeTab === 'dashboard' ? ' is-active' : ''}`}
          onClick={() => handleTabChange('dashboard')}
        >
          Live Dashboard
        </button>
        <button
          type="button"
          className={`app-tab${activeTab === 'compare' ? ' is-active' : ''}`}
          onClick={() => handleTabChange('compare')}
        >
          Result Compare
        </button>
        <button
          type="button"
          className={`app-tab${activeTab === 'analysis' ? ' is-active' : ''}`}
          onClick={() => handleTabChange('analysis')}
        >
          Result Analysis
        </button>
      </nav>

      <section
        className={`app-tab-panel${activeTab === 'dashboard' ? ' is-active' : ''}`}
        aria-hidden={activeTab !== 'dashboard'}
      >
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
                canStart={connectionStatus === 'connected'}
                maxNumVehicles={state.maxNumVehicles}
                vehCapacity={state.vehCapacity}
                maxWaitTime={state.maxWaitTime}
                hiddenDim={state.hiddenDim}
                batchSize={state.batchSize}
                learningRate={state.learningRate}
                selectedScenario={state.selectedScenario}
                availableScenarios={state.availableScenarios}
                scenarioSelectionLocked={scenarioSelectionLocked}
                onScenarioChange={handleScenarioChange}
                onStart={handleStart}
                onStop={stop}
                onReset={reset}
                canSaveReplay={!isRunning && history.hasHistory}
                isSavingReplay={isSavingReplay}
                onSaveReplay={handleSaveReplay}
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
                replayTime={history.replayTime}
              />
              <DetourFactorChart
                data={history.analysis.detourFactorData}
                replayTime={history.replayTime}
              />
              <VehicleTimelineChart
                data={history.analysis.timelineData}
                replayTime={history.replayTime}
                statusShare={history.analysis.summary}
                passengerLoadData={history.analysis.passengerLoadData}
                vehicleCapacity={state.vehCapacity}
              />
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
      </section>
      <section
        className={`app-tab-panel${activeTab === 'compare' ? ' is-active' : ''}`}
        aria-hidden={activeTab !== 'compare'}
      >
        {visitedTabs.has('compare') ? (
          <Suspense fallback={<div className="compare-empty-text">Loading result comparison...</div>}>
            <ResultCompare />
          </Suspense>
        ) : null}
      </section>
      <section
        className={`app-tab-panel${activeTab === 'analysis' ? ' is-active' : ''}`}
        aria-hidden={activeTab !== 'analysis'}
      >
        {visitedTabs.has('analysis') ? (
          <Suspense fallback={<div className="compare-empty-text">Loading result analysis...</div>}>
            <ResultAnalysis />
          </Suspense>
        ) : null}
      </section>
    </div>
  );
}
