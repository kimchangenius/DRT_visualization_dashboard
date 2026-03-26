import type { ConnectionStatus } from '../hooks/useWebSocketSimulation';

interface HeaderProps {
  currentTime: number;
  connected: boolean;
  connectionStatus: ConnectionStatus;
  reconnectAttempt: number;
}

export default function Header({ currentTime, connectionStatus, reconnectAttempt }: HeaderProps) {
  const formatTime = (t: number) => {
    const hours = Math.floor(t / 60);
    const mins = t % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  const statusLabel = () => {
    switch (connectionStatus) {
      case 'connected': return 'Connected';
      case 'reconnecting': return `Reconnecting (#${reconnectAttempt})`;
      case 'disconnected': return 'Disconnected';
    }
  };

  return (
    <header className="dashboard-header">
      <div className="header-title">
        <h1>Sioux Falls DRT</h1>
        <span className="header-subtitle">Demand Responsive Transit Simulation</span>
      </div>
      <div className="header-info">
        <div className="sim-time">
          <span className="time-label">Sim Time</span>
          <span className="time-value">{formatTime(currentTime)}</span>
        </div>
        <div className={`connection-badge ${connectionStatus}`}>
          <span className="status-dot" />
          {statusLabel()}
        </div>
      </div>
    </header>
  );
}
