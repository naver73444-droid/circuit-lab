import { ScopeView } from "../../src/scope-view.js";

const telemetry = {
  schema: 1,
  label: "CIRCUIT-008 attempt-02 visible verification telemetry",
  counters: { render: 0, renderCursor: 0, setData: 0, readoutChanges: 0, traceAxisMutations: 0 },
  latestRaw: null,
  latestSeries: null,
  lastBlob: null,
  errors: [],
};

const panel = document.createElement("details");
panel.id = "attempt-02-telemetry";
panel.open = true;
panel.style.cssText = "position:fixed;z-index:99999;right:8px;bottom:8px;width:min(520px,calc(100vw - 16px));max-height:38vh;overflow:auto;background:#fff;border:2px solid #176baf;padding:6px;color:#111;font:11px/1.35 monospace";
const summary = document.createElement("summary");
summary.textContent = "CIRCUIT-008 attempt-02 검증 계측";
const output = document.createElement("pre");
output.id = "attempt-02-telemetry-json";
output.setAttribute("aria-live", "polite");
output.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0 0";
panel.append(summary, output);
document.body.append(panel);

function publish() {
  output.textContent = JSON.stringify(telemetry, null, 2);
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

let captureSerial = 0;
async function captureResult(result, series) {
  const serial = ++captureSerial;
  try {
    const rawText = JSON.stringify({
      analysis: result?.analysis ?? null,
      xValues: result?.xValues ?? [],
      points: (result?.points ?? []).map((point) => ({ nodeVoltages: point.nodeVoltages, componentCurrents: point.componentCurrents })),
    });
    const seriesText = JSON.stringify((series ?? []).map(({ key, label, quantity, values }) => ({ key, label, quantity, values })));
    const [rawHash, seriesHash] = await Promise.all([sha256(rawText), sha256(seriesText)]);
    if (serial !== captureSerial) return;
    telemetry.latestRaw = { analysis: result?.analysis ?? null, samples: result?.xValues?.length ?? 0, bytes: new TextEncoder().encode(rawText).length, sha256: rawHash };
    telemetry.latestSeries = { traces: series?.length ?? 0, bytes: new TextEncoder().encode(seriesText).length, sha256: seriesHash };
    publish();
  } catch (error) {
    telemetry.errors.push(`result capture: ${error.message}`);
    publish();
  }
}

const originalSetData = ScopeView.prototype.setData;
ScopeView.prototype.setData = function (...args) {
  telemetry.counters.setData += 1;
  const returned = originalSetData.apply(this, args);
  void captureResult(args[0], args[1]);
  publish();
  return returned;
};

const originalRender = ScopeView.prototype.render;
ScopeView.prototype.render = function (...args) {
  telemetry.counters.render += 1;
  const returned = originalRender.apply(this, args);
  publish();
  return returned;
};

const originalRenderCursor = ScopeView.prototype.renderCursor;
ScopeView.prototype.renderCursor = function (...args) {
  telemetry.counters.renderCursor += 1;
  const returned = originalRenderCursor.apply(this, args);
  publish();
  return returned;
};

const originalCreateObjectURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = function (blob) {
  const returned = originalCreateObjectURL(blob);
  void (async () => {
    try {
      const text = await blob.text();
      telemetry.lastBlob = { type: blob.type, bytes: blob.size, sha256: await sha256(text), text };
    } catch (error) {
      telemetry.errors.push(`blob capture: ${error.message}`);
    }
    publish();
  })();
  return returned;
};

await import("../../src/app.js");

const readout = document.querySelector("#cursor-readout");
if (readout) new MutationObserver(() => { telemetry.counters.readoutChanges += 1; publish(); })
  .observe(readout, { childList: true, characterData: true, subtree: true });

const plot = document.querySelector("#wave-plot");
if (plot) new MutationObserver((records) => {
  for (const record of records) {
    const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    if (target?.closest?.("#scope-cursor")) continue;
    telemetry.counters.traceAxisMutations += 1;
  }
  publish();
}).observe(plot, { childList: true, characterData: true, attributes: true, subtree: true });

publish();
