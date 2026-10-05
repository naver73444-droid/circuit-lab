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

export function dcOperatingPointModel(series) {
  const axes = displayAxes(series, [0]);
  return {
    xLabel: "DC operating point · 시간축 없음",
    axes,
    levels: series.map((item) => ({
      label: item.probe.label,
      color: item.probe.color,
      unit: item.unit,
      value: item.values[0],
    })),
  };
}
