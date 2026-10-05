export function acMagnitudeLevel(value, baseUnit) {
  if (baseUnit !== "V" && baseUnit !== "A") throw new Error(`지원하지 않는 AC 단위입니다: ${baseUnit}`);
  const magnitude = Math.hypot(value.re, value.im);
  return {
    value: 20 * Math.log10(magnitude),
    unit: baseUnit === "V" ? "dBV" : "dBA",
  };
}

export function acPhaseDegrees(value) {
  if (value.re === 0 && value.im === 0) return null;
  return (Math.atan2(value.im, value.re) * 180) / Math.PI;
}
