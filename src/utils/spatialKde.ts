export interface WeightedSpatialPoint {
  x: number;
  y: number;
  weight: number;
}

export interface SpatialKdeTarget<Key> {
  key: Key;
  x: number;
  y: number;
}

export interface SharedSpatialKde<Key> {
  bandwidth: number;
  densities: Map<Key, number>;
  maxDensity: number;
  quartiles: [number, number, number];
}

const MIN_BANDWIDTH = 8;
const MAX_BANDWIDTH = 45;
const FALLBACK_BANDWIDTH = 18;

export function estimateScottBandwidth(points: WeightedSpatialPoint[]): number {
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  if (totalWeight <= 1) return FALLBACK_BANDWIDTH;

  const meanX = points.reduce((sum, point) => sum + point.x * point.weight, 0) / totalWeight;
  const meanY = points.reduce((sum, point) => sum + point.y * point.weight, 0) / totalWeight;
  const varianceX = points.reduce(
    (sum, point) => sum + point.weight * (point.x - meanX) ** 2,
    0,
  ) / totalWeight;
  const varianceY = points.reduce(
    (sum, point) => sum + point.weight * (point.y - meanY) ** 2,
    0,
  ) / totalWeight;
  const spatialScale = Math.sqrt((varianceX + varianceY) / 2);
  const bandwidth = spatialScale * totalWeight ** (-1 / 6);

  if (!Number.isFinite(bandwidth) || bandwidth <= 0) return FALLBACK_BANDWIDTH;
  return Math.min(MAX_BANDWIDTH, Math.max(MIN_BANDWIDTH, bandwidth));
}

export function gaussianIntensity(
  target: Pick<WeightedSpatialPoint, 'x' | 'y'>,
  observations: WeightedSpatialPoint[],
  bandwidth: number,
): number {
  if (observations.length === 0 || bandwidth <= 0) return 0;
  const variance = bandwidth ** 2;
  const normalization = 2 * Math.PI * variance;

  return observations.reduce((density, observation) => {
    const distanceSquared = (target.x - observation.x) ** 2 + (target.y - observation.y) ** 2;
    return density + observation.weight * Math.exp(-distanceSquared / (2 * variance)) / normalization;
  }, 0);
}

function quantile(sortedValues: number[], probability: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * fraction;
}

export function densityQuartiles(values: number[]): [number, number, number] {
  const positiveValues = values.filter(value => value > 0).sort((a, b) => a - b);
  return [
    quantile(positiveValues, 0.25),
    quantile(positiveValues, 0.5),
    quantile(positiveValues, 0.75),
  ];
}

export function buildSharedSpatialKde<Key>(
  targets: SpatialKdeTarget<Key>[],
  observations: WeightedSpatialPoint[],
  comparisonTargets: Array<Pick<WeightedSpatialPoint, 'x' | 'y'>>,
  comparisonObservations: WeightedSpatialPoint[],
  bandwidthObservations: WeightedSpatialPoint[],
): SharedSpatialKde<Key> {
  const bandwidth = estimateScottBandwidth(bandwidthObservations);
  const densities = new Map(targets.map(target => [
    target.key,
    gaussianIntensity(target, observations, bandwidth),
  ]));
  const comparisonDensities = comparisonTargets.map(target =>
    gaussianIntensity(target, comparisonObservations, bandwidth),
  );
  const sharedDensities = [...densities.values(), ...comparisonDensities];
  return {
    bandwidth,
    densities,
    maxDensity: Math.max(0, ...sharedDensities),
    quartiles: densityQuartiles(sharedDensities),
  };
}

export function quartileHeatColor(
  density: number,
  [q1, q2, q3]: [number, number, number],
): string {
  if (density >= q3) return '#e31a1c';
  if (density >= q2) return '#fd8d3c';
  if (density >= q1) return '#fecc5c';
  return '#ffffb2';
}

export function paperQuartileHeatColor(
  density: number,
  [q1, q2, q3]: [number, number, number],
): string {
  if (density >= q3) return '#2171b5';
  if (density >= q2) return '#6baed6';
  if (density >= q1) return '#c6dbef';
  return '#f7fbff';
}

export function kernelDisplayRadius(bandwidth: number): number {
  return Math.min(38, Math.max(14, bandwidth));
}
