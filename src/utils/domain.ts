export type NumericDomain = [number, number];

export function domainFromValues(values: number[], fallback: NumericDomain = [0, 1]): NumericDomain {
  if (values.length === 0) return fallback;
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? [min, min + 1] : [min, max];
}

export function clampDomain(domain: NumericDomain, bounds: NumericDomain): NumericDomain {
  const [min, max] = bounds;
  const fullRange = Math.max(1, max - min);
  const range = Math.min(fullRange, Math.max(1, domain[1] - domain[0]));
  let start = domain[0];
  let end = start + range;

  if (start < min) {
    start = min;
    end = start + range;
  }
  if (end > max) {
    end = max;
    start = end - range;
  }

  return [Math.max(min, start), Math.min(max, end)];
}

export function zoomDomain(
  currentDomain: NumericDomain | null | undefined,
  fullDomain: NumericDomain,
  factor: number,
  anchorRatio = 0.5,
  minRangeRatio = 0.08,
): NumericDomain | null {
  const activeDomain = clampDomain(currentDomain ?? fullDomain, fullDomain);
  const fullRange = Math.max(1, fullDomain[1] - fullDomain[0]);
  const activeRange = Math.max(1, activeDomain[1] - activeDomain[0]);
  const minRange = Math.min(fullRange, Math.max(1, Math.round(fullRange * minRangeRatio)));
  const nextRange = Math.min(fullRange, Math.max(minRange, activeRange * factor));

  if (nextRange >= fullRange) return null;

  const center = activeDomain[0] + activeRange * anchorRatio;
  return clampDomain(
    [center - nextRange * anchorRatio, center + nextRange * (1 - anchorRatio)],
    fullDomain,
  );
}
