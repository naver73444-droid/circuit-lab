import { acMagnitudeLevel, acPhaseDegrees } from "./plot-format.js";
import { basisSuffix, scaleComplex } from "./ac-basis.js";

export function escapeCSVField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function stringifyCSV(rows) {
  return rows.map((row) => row.map(escapeCSVField).join(",")).join("\r\n");
}

/**
 * acBasis: undefined keeps the legacy file exactly (peak amplitudes, unmarked headers). "peak" / "rms" writes the AC magnitudes in that basis
 * (the dB level shifts by −3.0103 dB for rms) and marks the headers: `V(1)_magnitude_dBV_pk` / `_rms`. Phases and frequencies do not change.
 */
export function buildResultsCSV(result, series, acBasis) {
  const ac = result.analysis === "ac";
  const marked = ac && acBasis !== undefined, suffix = marked ? basisSuffix(acBasis) : "";
  const headers = [ac ? "frequency_Hz" : result.analysis === "dc" ? "operating_point" : "time_s"];
  for (const item of series) {
    if (ac) {
      const magnitudeUnit = item.probe.kind === "voltage" ? "dBV" : "dBA";
      headers.push(`${item.probe.label}_magnitude_${magnitudeUnit}${suffix}`, `${item.probe.label}_phase_deg`);
    } else headers.push(`${item.probe.label}_${item.probe.kind === "voltage" ? "V" : "A"}`);
  }
  // Imported labels can begin with spreadsheet formula characters. Protect only
  // textual headers, never prefix or rescale numeric SI measurement samples.
  const safeHeaders = headers.map((header) => /^\s*[=+\-@]|^[\t\r\n]/.test(header) ? `'${header}` : header);
  const rows = [safeHeaders];
  for (let index = 0; index < result.xValues.length; index += 1) {
    const row = [result.xValues[index]];
    for (const item of series) {
      if (ac) {
        const value = item.raw[index];
        const baseUnit = item.probe.kind === "voltage" ? "V" : "A";
        row.push(acMagnitudeLevel(marked ? scaleComplex(value, acBasis) : value, baseUnit).value, acPhaseDegrees(value));
      } else row.push(item.raw[index]);
    }
    rows.push(row);
  }
  return stringifyCSV(rows);
}
