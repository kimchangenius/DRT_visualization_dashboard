import type { Passenger } from '../types/simulation';

interface RequestInformationProps {
  passengers: Passenger[];
  currentTime: number;
}

function formatTime(t: number | null): string {
  if (t == null) return '—';
  return String(t);
}

function statusLabel(s: Passenger['status']): string {
  switch (s) {
    case 'waiting':
      return 'Waiting';
    case 'picked_up':
      return 'In vehicle';
    case 'delivered':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
    default:
      return s;
  }
}

export default function RequestInformation({ passengers, currentTime }: RequestInformationProps) {
  const rows = passengers
    .filter(
      p =>
        p.requestTime <= currentTime &&
        (p.status === 'waiting' || p.status === 'picked_up'),
    )
    .slice()
    .sort((a, b) => a.requestTime - b.requestTime || a.id - b.id);

  return (
    <div className="panel chart-panel request-information-panel">
      <h3 className="panel-title">Request Information</h3>
      <p className="request-information-sub">
        Active requests at simulation time <strong>t = {currentTime}</strong> · queue length: {rows.length}
      </p>
      <div className="chart-container request-information-scroll">
        {rows.length === 0 ? (
          <p className="request-information-empty">No active requests at this time.</p>
        ) : (
          <table className="request-information-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Req t</th>
                <th scope="col">Status</th>
                <th scope="col">Vehicle</th>
                <th scope="col">Pickup time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>{p.originNodeId}</td>
                  <td>{p.destinationNodeId}</td>
                  <td>{p.requestTime}</td>
                  <td>
                    <span className={`request-information-status request-information-status--${p.status}`}>
                      {statusLabel(p.status)}
                    </span>
                  </td>
                  <td>{p.assignedVehicleId != null ? p.assignedVehicleId : '—'}</td>
                  <td>{formatTime(p.pickupTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
