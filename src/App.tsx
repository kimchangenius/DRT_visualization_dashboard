import { useWebSocketSimulation } from './hooks/useWebSocketSimulation';
import Header from './components/Header';
import SimulationControls from './components/SimulationControls';
import NetworkMap from './components/NetworkMap';
import MetricsPanel from './components/MetricsPanel';
// import WaitTimeChart from './components/WaitTimeChart';
import RequestInformation from './components/RequestInformation';
import VehicleUtilChart from './components/VehicleUtilChart';
import PassengerChart from './components/PassengerChart';
import RequestStatusChart from './components/RequestStatusChart';
import './App.css';

export default function App() {
  const {
    state,
    connectionStatus,
    reconnectAttempt,
    isRunning,
    speed,
    start,
    stop,
    reset,
  } = useWebSocketSimulation();

  return (
    <div className="app">
      <div className="dashboard-layout">
        <div className="dashboard-layout-left">
          <div className="dashboard-left-top">
            <div className="dashboard-left-top-row">
              <Header
                currentTime={state.metrics.currentTime}
                connectionStatus={connectionStatus}
                reconnectAttempt={reconnectAttempt}
              />
              <MetricsPanel metrics={state.metrics} />
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
              />
            </aside>

            <section className="dashboard-left-map">
              <NetworkMap vehicles={state.vehicles} passengers={state.passengers} />
            </section>
          </div>
        </div>

        <aside className="dashboard-layout-right">
          <RequestInformation passengers={state.passengers} currentTime={state.metrics.currentTime} />
          <VehicleUtilChart data={state.utilizationHistory} />
          <PassengerChart data={state.passengerHistory} />
          <RequestStatusChart data={state.requestStatusData} />
        </aside>
      </div>
    </div>
  );
}
