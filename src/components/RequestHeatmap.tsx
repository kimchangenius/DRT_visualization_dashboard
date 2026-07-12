import { useMemo } from 'react';
import { links, nodeMap, nodes } from '../data/siouxFallsNetwork';
import type { Passenger } from '../types/simulation';
import {
  densityQuartiles,
  estimateScottBandwidth,
  gaussianIntensity,
  kernelDisplayRadius,
  quartileHeatColor,
  type WeightedSpatialPoint,
} from '../utils/spatialKde';

interface RequestHeatmapProps {
  title?: string;
  contextLabel?: string;
  vehicleId?: number | null;
  passengers: Passenger[];
  replayTime: number;
  comparisonPassengers?: Passenger[];
  comparisonReplayTime?: number;
  comparisonVehicleId?: number | null;
  embedded?: boolean;
  hideTitle?: boolean;
}

interface NodeRequestIntensity {
  nodeId: number;
  requestCount: number;
  passengerCount: number;
  passengerIds: number[];
}

const PADDING = 46;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 180;

function getPassengerUnits(passenger: Passenger): number {
  const count = passenger.numPassengers ?? 1;
  return Number.isFinite(count) && count > 0 ? count : 1;
}

function buildNodeIntensities(
  passengers: Passenger[],
  replayTime: number,
): NodeRequestIntensity[] {
  const intensityMap = new Map<number, NodeRequestIntensity>();

  for (const passenger of passengers) {
    if (passenger.requestTime > replayTime) continue;
    if (!nodeMap.has(passenger.originNodeId)) continue;

    const intensity = intensityMap.get(passenger.originNodeId) ?? {
      nodeId: passenger.originNodeId,
      requestCount: 0,
      passengerCount: 0,
      passengerIds: [],
    };
    intensity.requestCount += 1;
    intensity.passengerCount += getPassengerUnits(passenger);
    intensity.passengerIds.push(passenger.id);
    intensityMap.set(passenger.originNodeId, intensity);
  }

  return [...intensityMap.values()].sort((a, b) =>
    b.requestCount - a.requestCount ||
    b.passengerCount - a.passengerCount ||
    a.nodeId - b.nodeId,
  );
}

function requestObservations(intensities: NodeRequestIntensity[]): WeightedSpatialPoint[] {
  return intensities.flatMap(intensity => {
    const node = nodeMap.get(intensity.nodeId);
    return node ? [{ x: node.x, y: node.y, weight: intensity.requestCount }] : [];
  });
}

export default function RequestHeatmap({
  title = 'Request Heatmap',
  contextLabel,
  vehicleId = null,
  passengers,
  replayTime,
  comparisonPassengers,
  comparisonReplayTime,
  comparisonVehicleId = null,
  embedded = false,
  hideTitle = false,
}: RequestHeatmapProps) {
  const filteredPassengers = useMemo(
    () => vehicleId == null
      ? passengers
      : passengers.filter(passenger => passenger.assignedVehicleId === vehicleId),
    [passengers, vehicleId],
  );
  const intensities = useMemo(
    () => buildNodeIntensities(filteredPassengers, replayTime),
    [filteredPassengers, replayTime],
  );
  const comparisonIntensities = useMemo(() => {
    if (!comparisonPassengers || comparisonReplayTime == null) return [];
    const filteredComparisonPassengers = comparisonVehicleId == null
      ? comparisonPassengers
      : comparisonPassengers.filter(passenger => passenger.assignedVehicleId === comparisonVehicleId);
    return buildNodeIntensities(filteredComparisonPassengers, comparisonReplayTime);
  }, [comparisonPassengers, comparisonReplayTime, comparisonVehicleId]);
  const intensityByNode = useMemo(
    () => new Map(intensities.map(intensity => [intensity.nodeId, intensity])),
    [intensities],
  );
  const kde = useMemo(() => {
    const observations = requestObservations(intensities);
    const comparisonObservations = requestObservations(comparisonIntensities);
    const bandwidth = estimateScottBandwidth([...observations, ...comparisonObservations]);
    const densities = new Map(nodes.map(node => [
      node.id,
      gaussianIntensity(node, observations, bandwidth),
    ]));
    const comparisonDensities = nodes.map(node =>
      gaussianIntensity(node, comparisonObservations, bandwidth),
    );
    const sharedDensities = [...densities.values(), ...comparisonDensities];
    return {
      bandwidth,
      densities,
      maxDensity: Math.max(0, ...sharedDensities),
      quartiles: densityQuartiles(sharedDensities),
    };
  }, [intensities, comparisonIntensities]);
  const totalRequests = intensities.reduce((sum, intensity) => sum + intensity.requestCount, 0);
  const totalPassengers = intensities.reduce((sum, intensity) => sum + intensity.passengerCount, 0);
  const panelClassName = embedded ? 'request-heatmap-panel request-heatmap-panel-embedded' : 'panel chart-panel request-heatmap-panel';
  const displayContext = contextLabel ?? (vehicleId == null ? `t=${replayTime}` : `V${vehicleId} · t=${replayTime}`);
  const mapLabel = vehicleId == null
    ? `${title} at ${displayContext}`
    : `Vehicle V${vehicleId} ${title} at ${displayContext}`;

  return (
    <div className={panelClassName}>
      {!hideTitle ? (
        <div className="request-heatmap-head">
          <h3 className="panel-title">{title}</h3>
          <span className="request-heatmap-context">{displayContext}</span>
        </div>
      ) : null}
      <div className="request-heatmap-container">
        <div className="request-heatmap-svg-wrap">
          <svg
            viewBox={`-${PADDING} -${PADDING} ${MAP_WIDTH + PADDING * 2} ${MAP_HEIGHT + PADDING * 2}`}
            preserveAspectRatio="xMidYMid meet"
            className="request-heatmap-svg"
            aria-label={mapLabel}
          >
            <defs>
              <filter id="request-heatmap-blur" x="-35%" y="-35%" width="170%" height="170%">
                <feGaussianBlur stdDeviation="5.5" />
              </filter>
            </defs>

            {links.filter((_, index) => index % 2 === 0).map(link => {
              const from = nodeMap.get(link.from);
              const to = nodeMap.get(link.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`heatmap-base-link-${link.id}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className="request-heatmap-base-link"
                />
              );
            })}

            <g filter="url(#request-heatmap-blur)">
              {intensities.map(intensity => {
                const node = nodeMap.get(intensity.nodeId);
                if (!node || kde.maxDensity <= 0) return null;
                const density = kde.densities.get(node.id) ?? 0;
                const ratio = density / kde.maxDensity;
                const color = quartileHeatColor(density, kde.quartiles);
                return (
                  <circle
                    key={`heat-field-${intensity.nodeId}`}
                    cx={node.x}
                    cy={node.y}
                    r={kernelDisplayRadius(kde.bandwidth)}
                    fill={color}
                    fillOpacity={0.18 + ratio * 0.34}
                    className="request-heatmap-field"
                  >
                    <title>
                      {`N${intensity.nodeId}: ${intensity.requestCount} calls · ${intensity.passengerCount} passengers · KDE ${density.toFixed(4)}`}
                    </title>
                  </circle>
                );
              })}
            </g>

            {nodes.map(node => {
              const intensity = intensityByNode.get(node.id);
              const density = kde.densities.get(node.id) ?? 0;
              const color = intensity ? quartileHeatColor(density, kde.quartiles) : '#1e293b';
              const passengerLabel = intensity?.passengerIds.map(id => `P${id}`).join(', ') ?? '';

              return (
                <g key={`heatmap-node-${node.id}`} className="request-heatmap-node">
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={intensity ? 6.4 : 4.5}
                    fill={intensity ? color : '#1e293b'}
                    fillOpacity={intensity ? 0.88 : 1}
                    stroke={intensity ? '#f8fafc' : '#64748b'}
                    strokeWidth={intensity ? 0.85 : 0.8}
                  >
                    {intensity ? (
                      <title>
                        {`N${node.id}: ${intensity.requestCount} calls · ${intensity.passengerCount} passengers · KDE ${density.toFixed(4)} · ${passengerLabel}`}
                      </title>
                    ) : null}
                  </circle>
                  <text x={node.x} y={node.y + 0.4} textAnchor="middle" dominantBaseline="middle">
                    {node.label}
                  </text>
                  {intensity ? (
                    <g transform={`translate(${node.x + 8.2} ${node.y - 7.2})`}>
                      <circle r={6} className="request-heatmap-count-bg" />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        className="request-heatmap-count-label"
                      >
                        {intensity.requestCount}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {intensities.length === 0 ? (
            <p className="request-heatmap-empty">No calls at this time</p>
          ) : null}
        </div>
        <div className="request-heatmap-footer">
          <div className="request-heatmap-status-mix" aria-label="Request heatmap totals">
            <span>Calls {totalRequests}</span>
            <span>Passengers {totalPassengers}</span>
          </div>
          <div className="request-heatmap-scale" aria-label="Request concentration scale">
            <span>Low</span>
            <span className="request-heatmap-scale-bar" />
            <span>High</span>
          </div>
        </div>
      </div>
    </div>
  );
}
