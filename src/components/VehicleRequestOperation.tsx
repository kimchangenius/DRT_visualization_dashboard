import { useMemo } from 'react';
import type { Passenger } from '../types/simulation';

interface VehicleRequestOperationProps {
  vehicleId: number;
  assignedPassengers: Passenger[];
  replayTime: number;
}

function statusLabel(s: Passenger['status']): string {
  switch (s) {
    case 'waiting': return 'Waiting';
    case 'picked_up': return 'In vehicle';
    case 'delivered': return 'Served';
    case 'cancelled': return 'Cancelled';
    default: return s;
  }
}

function formatTime(t: number | null): string {
  if (t == null) return '—';
  return String(t);
}

export default function VehicleRequestOperation({
  vehicleId,
  assignedPassengers,
  replayTime,
}: VehicleRequestOperationProps) {
  const rows = useMemo(() =>
    assignedPassengers
      .filter(p => p.requestTime <= replayTime)
      .slice()
      .sort((a, b) => a.requestTime - b.requestTime || a.id - b.id),
    [assignedPassengers, replayTime],
  );

  const served = rows.filter(p => p.deliveryTime != null && p.deliveryTime <= replayTime).length;
  const inVehicle = rows.filter(p => p.pickupTime != null && p.pickupTime <= replayTime && (p.deliveryTime == null || p.deliveryTime > replayTime)).length;
  const waiting = rows.filter(p => (p.pickupTime == null || p.pickupTime > replayTime) && p.status !== 'cancelled').length;
  const cancelled = rows.filter(p => p.status === 'cancelled').length;

  return (
    <div className="panel chart-panel request-information-panel">
      <h3 className="panel-title">Vehicle V{vehicleId} Request Operation</h3>
      <p className="request-information-sub">
        Accepted requests at <strong>t = {replayTime}</strong>
        {' · '}
        <span style={{ color: '#fbbf24' }}>{waiting} waiting</span>
        {' · '}
        <span style={{ color: '#38bdf8' }}>{inVehicle} in vehicle</span>
        {' · '}
        <span style={{ color: '#4ade80' }}>{served} served</span>
        {cancelled > 0 && (
          <>
            {' · '}
            <span style={{ color: '#f87171' }}>{cancelled} cancelled</span>
          </>
        )}
      </p>
      <div className="chart-container request-information-scroll">
        {rows.length === 0 ? (
          <p className="request-information-empty">No accepted requests at this time.</p>
        ) : (
          <table className="request-information-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Req t</th>
                <th scope="col">Status</th>
                <th scope="col">Pickup t</th>
                <th scope="col">Delivery t</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const atReplayTime =
                  p.deliveryTime != null && p.deliveryTime <= replayTime
                    ? 'delivered'
                    : p.pickupTime != null && p.pickupTime <= replayTime
                      ? 'picked_up'
                      : p.status === 'cancelled'
                        ? 'cancelled'
                        : 'waiting';
                return (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{p.originNodeId}</td>
                    <td>{p.destinationNodeId}</td>
                    <td>{p.requestTime}</td>
                    <td>
                      <span className={`request-information-status request-information-status--${atReplayTime}`}>
                        {statusLabel(atReplayTime)}
                      </span>
                    </td>
                    <td>{p.pickupTime != null && p.pickupTime <= replayTime ? formatTime(p.pickupTime) : '—'}</td>
                    <td>{p.deliveryTime != null && p.deliveryTime <= replayTime ? formatTime(p.deliveryTime) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
