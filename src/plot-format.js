export function currentDisplayScale(rawSeries) {
  let maximum = 0;
  for (const values of rawSeries) {
    for (const value of values) {
      if (Number.isFinite(value)) maximum = Math.max(maximum, Math.abs(value));
    }
  }
  if (maximum < 1e-4) return { scale: 1e6, unit: "µA" };
  if (maximum < 0.1) return { scale: 1e3, unit: "mA" };
  return { scale: 1, unit: "A" };
}

export function displayAxes(series, visibleIndexes) {
  const grouped = new Map();
  for (const item of series) {
    if (!grouped.has(item.unit)) grouped.set(item.unit, []);
    grouped.get(item.unit).push(item);
  }
  const priority = (unit) => unit === "V" || unit === "dBV" || unit === "°" ? 0 : 1;
  return [...grouped.entries()]
    .sort(([left], [right]) => priority(left) - priority(right))
    .map(([unit, items]) => {
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (const item of items) {
        for (const index of visibleIndexes) {
          const value = item.values[index];
          if (!Number.isFinite(value)) continue;
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
      }
      if (!Number.isFinite(minimum)) {
        minimum = -1;
        maximum = 1;
      }
      if (Math.abs(maximum - minimum) < 1e-12) {
        const padding = Math.max(1, Math.abs(maximum) * 0.2);
        minimum -= padding;
        maximum += padding;
      } else {
        const padding = (maximum - minimum) * 0.08;
        minimum -= padding;
        maximum += padding;
      }
      return { unit, items, minimum, maximum };
    });
}

// ---- AC level/phase of a complex sample (formerly measurement-format.js)
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
