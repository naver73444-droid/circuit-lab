// Test-only: build a complex phasor from magnitude and angle in degrees.
export function phasorFromPolar(magnitude, angleDegrees) {
  const angle = (angleDegrees * Math.PI) / 180;
  return { re: magnitude * Math.cos(angle), im: magnitude * Math.sin(angle) };
}
