// Display basis of the circuit editor's AC results: "peak" (the solver's own scale: V is the maximum of V·cos(ωt+φ)) or "rms" (peak/√2, the
// textbook scale). Only the DISPLAY changes: solving, stored source values and project files stay peak. Pure: no DOM, no state.
export const AC_BASES = Object.freeze(['peak', 'rms']);
export const normalizeAcBasis = (basis) => (basis === 'rms' ? 'rms' : 'peak');
/** Factor that turns a peak amplitude into the displayed amplitude. */
export const acScale = (basis) => (normalizeAcBasis(basis) === 'rms' ? Math.SQRT1_2 : 1);
export const fromPeak = (value, basis) => value * acScale(basis);
export const toPeak = (value, basis) => value / acScale(basis);
export const scaleComplex = (z, basis) => { const k = acScale(basis); return k === 1 ? z : { re: z.re * k, im: z.im * k }; };
/** "V (peak)" / "V (rms)": the course-wide notation of an amplitude unit. */
export const unitWithBasis = (unit, basis) => `${unit} (${normalizeAcBasis(basis)})`;
/** Header suffix of exported amplitudes: "_pk" / "_rms". */
export const basisSuffix = (basis) => (normalizeAcBasis(basis) === 'rms' ? '_rms' : '_pk');
/** dB shift of a level (20·log10 of the amplitude) when the amplitude is shown in this basis: 0 for peak, −3.0103 dB for rms. */
export const levelOffsetDb = (basis) => 20 * Math.log10(acScale(basis));

/** Complex power of a pair of peak phasors, S = ½·V_pk·I_pk* = V_rms·I_rms*: the same number in either basis. */
export function complexPowerOfPeakPhasors(voltage, current) {
  const re = 0.5 * (voltage.re * current.re + voltage.im * current.im), im = 0.5 * (voltage.im * current.re - voltage.re * current.im);
  return { re, im, P: re, Q: im, apparent: Math.hypot(re, im) };
}
/** Average power written in the shown basis: the label differs, the number does not. */
export function averagePowerLabel(basis) {
  return normalizeAcBasis(basis) === 'rms' ? '평균 소비 전력(rms 페이저 기준 Re(V·I*))' : '평균 소비 전력(peak 페이저 기준 ½·Re(V·I*))';
}
export const averagePowerFormula = (basis) => (normalizeAcBasis(basis) === 'rms' ? 'P = Re(V_rms·I_rms*)' : 'P = ½·Re(V_pk·I_pk*)');
/** A shown amplitude as editable text (12 significant digits, no float noise): 169.7056274847714 pk → "120" rms. */
export const amplitudeText = (peakValue, basis) => String(Number(fromPeak(peakValue, basis).toPrecision(12)));
