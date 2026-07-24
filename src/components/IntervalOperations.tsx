import {
  REQUEST_OUTCOME_COLORS,
  VEHICLE_STATUS_COLORS,
} from '../config';
import type { VehicleIntervalAnalysis } from '../utils/vehicleIntervalAnalysis';

interface IntervalOperationsProps {
  analysis: VehicleIntervalAnalysis;
}

function formatValue(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 10 ? 2 : 1,
  });
}

function formatTime(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function requestList(requestIds: readonly number[]): string {
  return requestIds.map(requestId => `R${requestId}`).join(', ');
}

export default function IntervalOperations({
  analysis,
}: IntervalOperationsProps) {
  const pickupDistanceRatio = analysis.distance.total > 0
    ? analysis.distance.picking_up / analysis.distance.total
    : 0;
  const carryingDistanceRatio = analysis.distance.total > 0
    ? analysis.distance.carrying / analysis.distance.total
    : 0;
  const acceptedRatio = analysis.requests.total > 0
    ? analysis.requests.accepted / analysis.requests.total
    : 0;
  const cancelledRatio = analysis.requests.total > 0
    ? analysis.requests.cancelled / analysis.requests.total
    : 0;
  const pendingRatio = Math.max(0, 1 - acceptedRatio - cancelledRatio);

  return (
    <div className="interval-operations">
      <div className="interval-operations-context">
        <strong>V{analysis.vehicleId}</strong>
        <span>Start t={formatTime(analysis.startTime)}</span>
        <span>End t={formatTime(analysis.endTime)}</span>
      </div>

      <section className="interval-operations-distance">
        <div className="interval-operations-section-head">
          <h4>Weighted distance</h4>
          <strong>{formatValue(analysis.distance.total)}</strong>
        </div>
        <div
          className={`interval-operations-distance-bar${analysis.distance.total === 0 ? ' is-empty' : ''}`}
          aria-label={`Pickup ${formatValue(analysis.distance.picking_up)}, carrying ${formatValue(analysis.distance.carrying)}`}
        >
          <span
            className="is-pickup"
            style={{
              width: `${pickupDistanceRatio * 100}%`,
              background: VEHICLE_STATUS_COLORS.picking_up,
            }}
          />
          <span
            className="is-carrying"
            style={{
              width: `${carryingDistanceRatio * 100}%`,
              background: VEHICLE_STATUS_COLORS.carrying,
            }}
          />
        </div>
        <dl className="interval-operations-distance-values">
          <div>
            <dt>Pickup</dt>
            <dd>{formatValue(analysis.distance.picking_up)}</dd>
          </div>
          <div>
            <dt>Carrying</dt>
            <dd>{formatValue(analysis.distance.carrying)}</dd>
          </div>
        </dl>
      </section>

      <div className="interval-operations-detail-grid">
        <section>
          <h4>Passenger load</h4>
          <dl className="interval-operations-paired-values">
            <div>
              <dt>Average onboard</dt>
              <dd>{formatValue(analysis.load.average)}</dd>
            </div>
            <div>
              <dt>Peak onboard</dt>
              <dd>{formatValue(analysis.load.maximum)}</dd>
            </div>
          </dl>
        </section>

        <section>
          <h4>Service events</h4>
          <dl className="interval-operations-paired-values">
            <div>
              <dt>Pickup</dt>
              <dd>
                {analysis.events.pickup}
                <small>{analysis.events.pickupPassengers} riders</small>
              </dd>
            </div>
            <div>
              <dt>Drop-off</dt>
              <dd>
                {analysis.events.dropoff}
                <small>{analysis.events.dropoffPassengers} riders</small>
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <div className="interval-operations-section-head">
            <h4>Request outcomes</h4>
            <strong>{analysis.requests.total}</strong>
          </div>
          <div
            className={`interval-operations-outcome-bar${analysis.requests.total === 0 ? ' is-empty' : ''}`}
            aria-label={`${analysis.requests.accepted} accepted, ${analysis.requests.cancelled} cancelled, ${analysis.requests.pending} pending`}
          >
            <span
              style={{
                width: `${acceptedRatio * 100}%`,
                background: REQUEST_OUTCOME_COLORS.accepted,
              }}
            />
            <span
              style={{
                width: `${cancelledRatio * 100}%`,
                background: REQUEST_OUTCOME_COLORS.cancelled,
              }}
            />
            <span
              style={{
                width: `${pendingRatio * 100}%`,
                background: REQUEST_OUTCOME_COLORS.pending,
              }}
            />
          </div>
          <dl className="interval-operations-outcome-values">
            <div>
              <dt><i style={{ background: REQUEST_OUTCOME_COLORS.accepted }} />Accepted</dt>
              <dd>{analysis.requests.accepted}</dd>
            </div>
            <div>
              <dt><i style={{ background: REQUEST_OUTCOME_COLORS.cancelled }} />Cancelled</dt>
              <dd>{analysis.requests.cancelled}</dd>
            </div>
            {analysis.requests.pending > 0 ? (
              <div>
                <dt><i style={{ background: REQUEST_OUTCOME_COLORS.pending }} />Pending</dt>
                <dd>{analysis.requests.pending}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>

      <section className="interval-operations-event-order">
        <h4>Event order</h4>
        {analysis.eventGroups.length > 0 ? (
          <ol aria-label="Interval events in time order">
            {analysis.eventGroups.map(event => (
              <li
                key={`interval-operation-event-${event.order}`}
                className={`is-${event.type}`}
              >
                <b>{event.order}</b>
                <strong>{requestList(event.requestIds)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <span>No pickup or drop-off events</span>
        )}
      </section>
    </div>
  );
}
