// Independent V/I sources seen as a function generator: one waveform choice ([DC] [사인] [구형]) and the knobs a bench generator has
// (level, amplitude in Vpp, frequency, offset, phase, duty). The part still stores the engine's props (mode SIN/PULSE/DC, amplitude in
// peak, pulse levels, period and width), so files and the engine are unchanged. What a SPICE source keeps as three separate settings
// (DC value, transient waveform, AC magnitude) is derived from the one waveform when a run starts (analysisCircuit):
//   DC analysis = the waveform's average (offset of a sine, mean of a square), AC/phasor = the sine's peak and phase, and when no
//   source is a sine, the first source is the 1 V (1 A) AC input. The phase field is the course's cos reference
//   (v = offset + Vpp/2 · cos(2πft + φ), phasor Vpk∠φ); the engine's SIN phase is sin-based, so it stores φ + 90°. Pure, no DOM.
import { componentDefaults, parseValue } from "./circuit-engine.js";
import { engineering } from "./scope-model.js";

const PREFIXES = [[1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "u"], [1e-9, "n"], [1e-12, "p"]];
/** A value as the editor writes it (`digits` significant digits and an SI letter: 1k, 333.333u). */
export function siValueText(value, digits = 6) {
  if (value === 0) return "0";
  const [scale, prefix] = PREFIXES.find(([size]) => Math.abs(value) >= size * (1 - 1e-9)) ?? PREFIXES[PREFIXES.length - 1];
  return String(Number((value / scale).toPrecision(digits))) + prefix;
}

export const WAVES = [["DC", "DC"], ["SIN", "사인"], ["SQUARE", "구형"]];
const SOURCE_TYPES = new Set(["V", "I"]);
/** What a fresh [사인]/[구형] starts from when the part was DC: a lab generator's 5 Vpp (2 mApp) at 1 kHz around 0. */
const LAB_DEFAULT = { V: { vpp: 5, frequency: 1000 }, I: { vpp: 2e-3, frequency: 1000 } };

const num = (value, fallback = NaN) => { try { const x = parseValue(value); return Number.isFinite(x) ? x : fallback; } catch { return fallback; } };
/** Shown values: 6 significant digits ("1k", "333.333u"). */
const text = (value) => siValueText(Number(value.toPrecision(12)));
/** Stored values: 12 significant digits, so 60 Hz → period 16.6666666667m reads back as 60 Hz and 50 %, not 59.9999. */
const store = (value) => siValueText(value, 12);
/** The engine's SIN phase (sin-based) for a cos-reference phase φ, and back. */
export const toEnginePhase = (cosDegrees) => String(Number((cosDegrees + 90).toPrecision(12)));
const fromEnginePhase = (sinPhase) => num(sinPhase ?? 0) - 90;
/** A square's rise + high time + fall must fit in one period. */
const edgesFit = (rise, fall, width, period) => rise + fall + width <= period * (1 + 1e-9);

export const isGeneratorSource = (component) => SOURCE_TYPES.has(component?.type);
export function waveOf(props) { return props?.mode === "SIN" ? "SIN" : props?.mode === "PULSE" ? "SQUARE" : "DC"; }

/** The generator knobs of a part as numbers: { wave, level } for DC, { wave, vpp, frequency, offset, phase } for a sine, and
 * { wave, vpp, frequency, offset, duty, delay, rise, fall, low, high } for a square. Unreadable values come back as NaN. */
export function generatorView(props = {}) {
  const wave = waveOf(props);
  if (wave === "DC") return { wave, level: num(props.dc ?? 0) };
  if (wave === "SIN") return { wave, vpp: 2 * num(props.amplitude ?? 0), frequency: num(props.frequency ?? 60), offset: num(props.offset ?? 0), phase: fromEnginePhase(props.phase) };
  const low = num(props.pulseV1 ?? 0), high = num(props.pulseV2 ?? 0), period = num(props.pulsePeriod ?? 2), width = num(props.pulseWidth ?? 1);
  return { wave, vpp: high - low, offset: (high + low) / 2, frequency: 1 / period, duty: 100 * width / period,
    delay: num(props.pulseDelay ?? 0), rise: num(props.pulseRise ?? 0), fall: num(props.pulseFall ?? 0), low, high };
}

/** The value a field shows: the stored text when the field is a stored prop, else the derived number written the editor's way. */
export function generatorFieldText(props, key) {
  const view = generatorView(props);
  const stored = { level: "dc", frequency: view.wave === "SIN" ? "frequency" : null, offset: view.wave === "SIN" ? "offset" : null,
    delay: "pulseDelay", rise: "pulseRise", fall: "pulseFall" }[key];
  if (stored && props[stored] !== undefined) return String(props[stored]);
  const value = view[key];
  if (value === undefined) return "";
  return Number.isFinite(value) ? (key === "duty" || key === "phase" ? String(Number(value.toPrecision(6))) : text(value)) : "";
}

function sharedKnobs(component) {
  const props = component.props ?? {}, view = generatorView(props), defaults = componentDefaults(component.type);
  const phase = props.phase ?? "0";
  if (view.wave !== "DC") return { vpp: view.vpp, frequency: view.frequency, offset: view.offset, phase };
  // From DC: a sine the part was given before (its stored values differ from the engine defaults), else the lab default, which starts
  // as a cosine (φ = 0 in the course's reference; the engine's sin phase 90°).
  const remembered = props.amplitude !== undefined && (props.amplitude !== defaults.amplitude || props.frequency !== defaults.frequency || phase !== defaults.phase);
  const lab = LAB_DEFAULT[component.type] ?? LAB_DEFAULT.V;
  return remembered
    ? { vpp: 2 * num(props.amplitude, lab.vpp / 2), frequency: num(props.frequency, lab.frequency), offset: num(props.offset ?? 0, 0), phase }
    : { vpp: lab.vpp, frequency: lab.frequency, offset: 0, phase: "90" };
}

function squareProps(props, { vpp, frequency, offset, duty }) {
  const period = 1 / frequency;
  return { mode: "PULSE", pulseV1: store(offset - vpp / 2), pulseV2: store(offset + vpp / 2), pulsePeriod: store(period), pulseWidth: store(period * duty / 100),
    pulseDelay: props.pulseDelay ?? "0", pulseRise: props.pulseRise ?? "0", pulseFall: props.pulseFall ?? "0" };
}

/**
 * The stored props an edit of one generator field sets, or null when the text is not a usable value (frequency > 0, amplitude ≥ 0,
 * 0 < duty < 100, times ≥ 0, a square's rise + width + fall within the period). Keys: wave (DC | SIN | SQUARE), level, vpp, frequency,
 * offset, phase, duty, delay, rise, fall. Switching between 사인 and 구형 keeps amplitude, frequency and offset, as a generator does.
 */
export function generatorEdit(component, key, value) {
  const props = component.props ?? {}, view = generatorView(props);
  if (key === "wave") {
    if (value === view.wave) return {};
    if (value === "DC") return { mode: "DC" };
    const knobs = sharedKnobs(component);
    if (![knobs.vpp, knobs.frequency, knobs.offset].every(Number.isFinite) || !(knobs.frequency > 0)) return null;
    if (value === "SIN") return { mode: "SIN", amplitude: store(knobs.vpp / 2), frequency: store(knobs.frequency), offset: store(knobs.offset), phase: String(knobs.phase) };
    if (value === "SQUARE") {
      const out = { ...squareProps(props, { ...knobs, duty: 50 }), phase: String(knobs.phase) };
      // Edges kept from an earlier square must still fit the new period: if not, the square starts with sharp edges.
      if (!edgesFit(num(out.pulseRise, 0), num(out.pulseFall, 0), num(out.pulseWidth), num(out.pulsePeriod))) Object.assign(out, { pulseRise: "0", pulseFall: "0" });
      return out;
    }
    return null;
  }
  const x = num(value);
  if (!Number.isFinite(x)) return null;
  if (view.wave === "DC") return key === "level" ? { dc: String(value) } : null;
  if (view.wave === "SIN") {
    if (key === "vpp") return x >= 0 ? { amplitude: store(x / 2) } : null;
    if (key === "frequency") return x > 0 ? { frequency: String(value) } : null;
    if (key === "offset") return { offset: String(value) };
    if (key === "phase") return { phase: toEnginePhase(x) };
    return null;
  }
  if (![view.vpp, view.frequency, view.offset, view.duty].every(Number.isFinite)) return null;
  const knobs = { vpp: view.vpp, frequency: view.frequency, offset: view.offset, duty: view.duty };
  if (key === "vpp") { if (!(x >= 0)) return null; knobs.vpp = x; }
  else if (key === "frequency") { if (!(x > 0)) return null; knobs.frequency = x; }
  else if (key === "offset") knobs.offset = x;
  else if (key === "duty") { if (!(x > 0 && x < 100)) return null; knobs.duty = x; }
  else if (["delay", "rise", "fall"].includes(key)) {
    if (!(x >= 0)) return null;
    const next = { ...view, [key]: x };
    if (!edgesFit(next.rise, next.fall, next.duty / 100 / next.frequency, 1 / next.frequency)) return null;
    return { [{ delay: "pulseDelay", rise: "pulseRise", fall: "pulseFall" }[key]]: String(value) };
  } else return null;
  return edgesFit(view.rise, view.fall, knobs.duty / 100 / knobs.frequency, 1 / knobs.frequency) ? squareProps(props, knobs) : null;
}

/**
 * Several generator edits of one part applied in turn (frequency, then duty, …: each builds on the one before): the stored props that
 * end up different, or null when one of the edits is not usable.
 */
export function generatorPatch(component, edits) {
  const props = { ...(component.props ?? {}) };
  for (const [key, value] of edits) {
    const patch = generatorEdit({ ...component, props }, key, value);
    if (!patch) return null;
    Object.assign(props, patch);
  }
  const changed = Object.entries(props).filter(([key, value]) => String(component.props?.[key] ?? "") !== String(value));
  return Object.fromEntries(changed);
}

export const unitOf = (component) => (component.type === "I" ? "A" : "V");
/** 2.5 → "2.5 V", 1000 → "1 kHz", 5e-4 → "500 µs". */
const si = (value, unit) => engineering(Number(value.toPrecision(12)), unit, 6);

/** The canvas label in two parts: the waveform word ("사인") and its setting ("5 Vpp · 1 kHz"); a part that cannot be read has only the word. */
export function generatorLabelParts(component) {
  const view = generatorView(component.props ?? {}), unit = unitOf(component);
  const word = { DC: "DC", SIN: "사인", SQUARE: "구형" }[view.wave];
  if (view.wave === "DC") return { word, rest: Number.isFinite(view.level) ? si(view.level, unit) : "" };
  if (!Number.isFinite(view.vpp) || !Number.isFinite(view.frequency)) return { word, rest: "" };
  const offset = Number.isFinite(view.offset) && Math.abs(view.offset) > 1e-15 ? ` · ${view.offset > 0 ? "+" : "−"}${si(Math.abs(view.offset), unit)}` : "";
  return { word, rest: `${si(view.vpp, unit + "pp")} · ${si(view.frequency, "Hz")}${offset}` };
}
/** The canvas label: "DC 5 V", "사인 5 Vpp · 1 kHz", "구형 5 Vpp · 1 kHz". */
export function generatorLabel(component) {
  const { word, rest } = generatorLabelParts(component);
  return rest ? `${word} ${rest}` : word;
}

/** The DC level a DC analysis takes from the waveform: the level, a sine's offset, a square's average over a period. */
export function averageLevel(props) {
  const view = generatorView(props);
  if (view.wave === "DC") return view.level;
  if (view.wave === "SIN") return view.offset;
  const period = 1 / view.frequency, width = view.duty / 100 * period;
  return view.low + (view.high - view.low) * (width + (view.rise + view.fall) / 2) / period;
}

/**
 * The circuit an analysis runs: each V/I source gets the DC value and AC phasor its waveform implies (see the top of this file). The
 * input is not changed; null for the AC input when no V/I source exists. Returns { circuit, acInput } where acInput names the source
 * taken as the 1 V (1 A) AC input when no source is a sine (null otherwise).
 */
export function analysisCircuit(circuit) {
  const components = circuit?.components ?? [];
  const sources = components.filter(isGeneratorSource);
  const hasSine = sources.some((component) => waveOf(component.props) === "SIN");
  // No sine: the signal source is the first square (a DC supply is not an input), else the first source.
  const acInput = hasSine ? null : sources.find((component) => waveOf(component.props) === "SQUARE") ?? sources[0] ?? null;
  const next = components.map((component) => {
    if (!isGeneratorSource(component)) return component;
    const props = { ...(component.props ?? {}) };
    const wave = waveOf(props);
    if (wave === "SIN") {
      props.dc = String(props.offset ?? "0");
      props.acMagnitude = String(props.amplitude ?? "0");
      const phase = fromEnginePhase(props.phase);
      props.acPhase = String(Number.isFinite(phase) ? phase : -90);
    } else {
      if (wave === "SQUARE") { const average = averageLevel(props); if (Number.isFinite(average)) props.dc = String(average); }
      props.acMagnitude = component === acInput ? "1" : "0";
      props.acPhase = "0";
    }
    return { ...component, props };
  });
  return { circuit: { ...circuit, components: next }, acInput: acInput ? (acInput.props?.ref ?? acInput.id) : null };
}

/** Written by serializeProject: a file whose sources already follow this model is read as it is. */
export const SOURCE_MODEL = "generator";

const refOf = (component) => component.props.ref ?? component.id;
const differs = (a, b) => Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(b));

/** "V1: DC 값 5 V를 사인 오프셋으로 옮김" — a sine's offset takes the old DC value (the old engine's DC operating point read props.dc). */
function moveDcToOffset(component, notes) {
  const props = component.props, dc = props.dc ?? "0";
  if (num(dc) === num(props.offset ?? 0)) return;
  props.offset = String(dc);
  if (Number.isFinite(num(dc))) notes.push(`${refOf(component)}: DC 값 ${si(num(dc), unitOf(component))}를 사인 오프셋으로 옮김`);
}

/**
 * A DC or PULSE source of an old AC file becomes a sine at the file's phasor frequency (peak `amplitude`, cos phase `phase`). It is
 * centred on the old dc value when `biased` (a diode: that value set the operating point) or for a DC source (its level); a square
 * without a diode is centred on its average, not on a dc value the student never saw.
 */
function toSine(props, { biased, amplitude = "0", phase = 0, frequency }) {
  const average = waveOf(props) === "SQUARE" ? averageLevel(props) : NaN;
  const offset = !biased && Number.isFinite(average) ? store(average) : String(props.dc ?? "0");
  Object.assign(props, { mode: "SIN", offset, amplitude: String(amplitude), phase: toEnginePhase(phase), frequency: String(frequency) });
}

/** What the student saw of a source: its canvas label and, for a sine with an amplitude, its phase (null otherwise). */
function seen(component) {
  const props = component.props, sounding = waveOf(props) === "SIN" && num(props.amplitude) !== 0;
  return { label: generatorLabel(component), phase: sounding ? generatorFieldText(props, "phase") : null };
}
/**
 * "V1: DC 12 V → 사인 2 Vpp · 1 kHz · +12 V, 위상 0°" when a migration changed the label or a sine's phase; the old phase is written
 * when it changed ("V1: 사인 2 Vpp · 60 Hz, 위상 -90° → 0°" for a phase alone).
 */
function noteChange(component, before, notes) {
  const after = seen(component), ref = refOf(component);
  if (after.label === before.label && after.phase === before.phase) return;
  // The same label means the same wave and Vpp, so both are sounding sines here.
  if (after.label === before.label) { notes.push(`${ref}: ${after.label}, 위상 ${before.phase}° → ${after.phase}°`); return; }
  const phase = (value) => value === null ? "" : `, 위상 ${value}°`;
  notes.push(`${ref}: ${before.label}${before.phase !== after.phase ? phase(before.phase) : ""} → ${after.label}${phase(after.phase)}`);
}

/**
 * One source of a file saved for the AC analysis before sources were generators: its separate AC magnitude/phase was what the file
 * computed, so it moves into the waveform and the AC answers stay the same. A sine whose own peak/phase differ takes the AC value
 * (peak = AC magnitude, cos phase = AC phase); a DC or PULSE source with a non-zero AC part becomes that sine at `frequency`.
 * `biased` (the circuit has a diode): the old DC value set the diode's operating point for the AC run, so a sine's offset takes it, a
 * square's sine is centred on it (toSine), and an AC 0 square whose average differs becomes a 0 Vpp sine around it.
 */
function migrateAcSource(component, { frequency, biased, notes }) {
  const props = component.props;
  if (props?.acMagnitude === undefined) return;
  const magnitude = num(props.acMagnitude), phase = num(props.acPhase ?? 0);
  if (!Number.isFinite(magnitude) || !Number.isFinite(phase)) return;
  if (props.mode === "SIN" && biased) moveDcToOffset(component, notes);
  const before = seen(component), wave = waveOf(props);
  if (wave === "SIN") {
    const same = !differs(num(props.amplitude ?? 0), magnitude) && Math.abs(((fromEnginePhase(props.phase) - phase) % 360 + 540) % 360 - 180) < 1e-9;
    if (!same) Object.assign(props, { amplitude: String(props.acMagnitude), phase: toEnginePhase(phase) });
  } else if (magnitude !== 0) {
    toSine(props, { biased, amplitude: props.acMagnitude, phase, frequency });
  } else if (biased && wave === "SQUARE") {
    const average = averageLevel(props), dc = num(props.dc ?? 0);
    if (Number.isFinite(average) && Number.isFinite(dc) && differs(average, dc)) toSine(props, { biased, frequency });
  }
  noteChange(component, before, notes);
}

/**
 * The parts of a file saved before sources were generators (`analysis` = the file's analysis, `frequency` its phasor frequency), changed
 * in place so that the analysis the file was saved for gives the same answers. Returns the notes for the notice shown on opening (one per
 * source whose waveform, level or phase changed).
 *   AC: each source as migrateAcSource (the bias moves only with a diode, where it changes the AC answer). When no sine is left but a
 *       source had an explicit AC 0, the first such source (a DC one first, so a square keeps its waveform) becomes a 0 Vpp sine:
 *       analysisCircuit then gives every source AC 0, as the file did, instead of making one the 1 V input. A file with no AC values
 *       at all keeps the 1 V input.
 *   DC: the old engine took a source's DC operating point from props.dc, a field the old inspector showed in the DC analysis; the new
 *       model takes a sine's offset and a square's average. A sine's offset takes dc; a square whose average differs cannot keep it and
 *       stays as it is, with a note.
 *   Transient: nothing moves (the waveform was what it computed).
 */
export function migrateGeneratorSources(components, { analysis, frequency = "1k" } = {}) {
  const notes = [], sources = components.filter(isGeneratorSource);
  if (analysis === "dc") {
    for (const component of sources) {
      const props = component.props ?? {}, wave = waveOf(props);
      if (props.dc === undefined) continue;
      if (wave === "SIN") moveDcToOffset(component, notes);
      const average = wave === "SQUARE" ? averageLevel(props) : NaN, old = num(props.dc);
      if (Number.isFinite(average) && Number.isFinite(old) && differs(average, old)) {
        notes.push(`${refOf(component)}: 구형의 DC 해석 값이 예전 DC 값 ${si(old, unitOf(component))}가 아닌 파형 평균 ${si(average, unitOf(component))}입니다`);
      }
    }
  } else if (analysis === "ac") {
    const biased = components.some((component) => component.type === "D");
    sources.forEach((component) => migrateAcSource(component, { frequency, biased, notes }));
    if (!sources.some((component) => waveOf(component.props) === "SIN")) {
      const silent = sources.filter((component) => component.props?.acMagnitude !== undefined && num(component.props.acMagnitude) === 0);
      const quiet = silent.find((component) => waveOf(component.props) === "DC") ?? silent[0];
      if (quiet) {
        const before = seen(quiet);
        toSine(quiet.props, { biased, frequency });
        noteChange(quiet, before, notes);
      }
    }
  }
  return notes;
}
