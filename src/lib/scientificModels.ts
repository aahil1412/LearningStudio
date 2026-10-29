/** Trusted illustrative models. Parameters have declared relative units; these
 * calculations are not quantum field theory, molecular dynamics, or a fit to data. */
export type FieldParameters = {
  amplitude: number;
  wavelength: number;
  width: number;
  speed: number;
  mode: "wave" | "packet";
};
export function fieldValue(x: number, time: number, p: FieldParameters) {
  const phase = x - p.speed * (time - 3);
  const envelope =
    p.mode === "packet"
      ? Math.exp((-phase * phase) / (2 * p.width * p.width))
      : 1;
  return (
    p.amplitude * envelope * Math.cos((2 * Math.PI * phase) / p.wavelength)
  );
}
export type AggregationParameters = {
  concentration: number;
  unfoldedFraction: number;
  attraction: number;
  partition: number;
  condensate: boolean;
};
export function aggregationKinetics(p: AggregationParameters, time: number) {
  const volume = p.condensate ? 0.25 : 0;
  const partition = p.condensate ? p.partition : 1;
  const denominator = 1 - volume + partition * volume;
  const coefficient =
    (1 - volume + partition * partition * volume) / (denominator * denominator);
  const initiallyUnfolded = p.concentration * p.unfoldedFraction;
  const unfoldedRemaining =
    initiallyUnfolded /
    (1 + p.attraction * coefficient * initiallyUnfolded * Math.max(0, time));
  const aggregatedFraction =
    (initiallyUnfolded - unfoldedRemaining) / p.concentration;
  const free = p.concentration * (1 - p.unfoldedFraction) + unfoldedRemaining;
  return {
    aggregatedFraction,
    unfoldedRemaining,
    free,
    insideFraction: (partition * volume) / denominator,
    aggregateInsideFraction: p.condensate
      ? (partition * partition * volume) /
        (1 - volume + partition * partition * volume)
      : 0,
    concentrationOutside: free / denominator,
    concentrationInside: p.condensate ? (partition * free) / denominator : 0,
    effectiveRate: p.attraction * coefficient,
  };
}
