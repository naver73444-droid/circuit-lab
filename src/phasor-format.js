const DEG_PER_RADIAN = 180 / Math.PI;

export function phasorFromPolar(magnitude, angleDegrees) {
  const angle = (angleDegrees * Math.PI) / 180;
  return { re: magnitude * Math.cos(angle), im: magnitude * Math.sin(angle) };
}

export function phasorPolar(value, zeroTolerance = 0) {
  const magnitude = Math.hypot(value.re, value.im);
  return {
    magnitude,
    angleDegrees: magnitude <= zeroTolerance ? null : Math.atan2(value.im, value.re) * DEG_PER_RADIAN,
  };
}

export function peakToRms(peak) {
  return peak / Math.sqrt(2);
}

export function phasorTimeValue(value, frequency, time) {
  const omegaTime = 2 * Math.PI * frequency * time;
  return value.re * Math.cos(omegaTime) - value.im * Math.sin(omegaTime);
}

export function divideComplex(numerator, denominator, zeroTolerance = 1e-18) {
  const squared = denominator.re ** 2 + denominator.im ** 2;
  if (squared <= zeroTolerance ** 2) return null;
  return {
    re: (numerator.re * denominator.re + numerator.im * denominator.im) / squared,
    im: (numerator.im * denominator.re - numerator.re * denominator.im) / squared,
  };
}

export function theoreticalImpedance(type, componentValue, frequency) {
  const omega = 2 * Math.PI * frequency;
  if (type === "R") return { re: componentValue, im: 0 };
  if (type === "L") return { re: 0, im: omega * componentValue };
  if (type === "C") return { re: 0, im: -1 / (omega * componentValue) };
  return null;
}

export function quantityDisplayScale(values, baseUnit) {
  if (!values.length) return { scale: 1, unit: baseUnit };
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.hypot(value.re, value.im));
  if (maximum === 0) return { scale: 1, unit: baseUnit };
  if (maximum < 1e-4) return { scale: 1e6, unit: `µ${baseUnit}` };
  if (maximum < 0.1) return { scale: 1e3, unit: `m${baseUnit}` };
  return { scale: 1, unit: baseUnit };
}

function niceCeiling(value) {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const power = 10 ** exponent;
  const fraction = value / power;
  const niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * power;
}

export function phasorAxis(values, baseUnit) {
  const display = quantityDisplayScale(values, baseUnit);
  const largestPeak = values.reduce((maximum, value) => Math.max(maximum, Math.hypot(value.re, value.im) * display.scale), 0);
  const maximum = niceCeiling(largestPeak);
  return {
    ...display,
    minimum: -maximum,
    maximum,
    ticks: [maximum, maximum / 2, 0, -maximum / 2, -maximum],
  };
}

export function wrapPhaseDifference(actual, expected) {
  return ((actual - expected + 540) % 360) - 180;
}
