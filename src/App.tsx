import { useWebSocketSimulation } from './hooks/useWebSocketSimulation';
import Header from './components/Header';
import SimulationControls from './components/SimulationControls';
import NetworkMap from './components/NetworkMap';
import MetricsPanel from './components/MetricsPanel';
import WaitTimeChart from './components/WaitTimeChart';
import VehicleUtilChart from './components/VehicleUtilChart';
import PassengerChart from './components/PassengerChart';
import TripStatusChart from './components/TripStatusChart';
import './App.css';

export default function App() {
  const {
    state,
    connected,
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
  } = useWebSocketSimulation();

  return (
    <div className="app">
      <div className="dashboard-top">
        <Header
          currentTime={state.metrics.currentTime}
          connected={connected}
          connectionStatus={connectionStatus}
          reconnectAttempt={reconnectAttempt}
        />
        <MetricsPanel metrics={state.metrics} />
      </div>

      <main className="dashboard-body">
        <aside className="dashboard-left">
          <SimulationControls
            isRunning={isRunning}
            speed={speed}
            vehicleCount={vehicleCount}
            onStart={start}
            onStop={stop}
            onReset={reset}
            onSpeedChange={setSpeed}
            onVehicleCountChange={setVehicleCount}
          />
        </aside>

        <section className="dashboard-center">
          <NetworkMap vehicles={state.vehicles} passengers={state.passengers} />
        </section>

        <aside className="dashboard-right">
          <WaitTimeChart data={state.waitTimeDistribution} />
          <VehicleUtilChart data={state.utilizationHistory} />
          <PassengerChart data={state.passengerHistory} />
          <TripStatusChart data={state.tripStatusData} />
        </aside>
      </main>
    </div>
  );
}
