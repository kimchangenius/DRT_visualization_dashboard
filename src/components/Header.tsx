import type { ConnectionStatus } from '../hooks/useWebSocketSimulation';

interface HeaderProps {
  currentTime: number;
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
      case 'connected':
        return 'Connected';
      case 'reconnecting':
        return `Reconnecting (#${reconnectAttempt})`;
      case 'disconnected':
        return 'Disconnected';
    }
  };

  return (
    <header className="dashboard-header">
      <div className="header-title">
        <h1>DRT Simulation Dashboard</h1>
        <span className="header-subtitle">DDQN-based simulation</span>
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
