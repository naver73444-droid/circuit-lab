import { acMagnitudeLevel, acPhaseDegrees } from "./measurement-format.js";

export function escapeCSVField(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function stringifyCSV(rows) {
  return rows.map((row) => row.map(escapeCSVField).join(",")).join("\r\n");
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field === "") quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r" && text[index + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("닫히지 않은 CSV 인용부호입니다.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function buildResultsCSV(result, series) {
  const ac = result.analysis === "ac";
  const headers = [ac ? "frequency_Hz" : result.analysis === "dc" ? "operating_point" : "time_s"];
  for (const item of series) {
    if (ac) {
      const magnitudeUnit = item.probe.kind === "voltage" ? "dBV" : "dBA";
      headers.push(`${item.probe.label}_magnitude_${magnitudeUnit}`, `${item.probe.label}_phase_deg`);
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
        row.push(acMagnitudeLevel(value, baseUnit).value, acPhaseDegrees(value));
      } else row.push(item.raw[index]);
    }
    rows.push(row);
  }
  return stringifyCSV(rows);
}
