import { divideComplex, peakToRms, phasorAxis, phasorPolar, phasorTimeValue, theoreticalImpedance } from "./phasor-format.js";
import { engineering } from "./scope-model.js";
import { escapeHtml } from "./safe-dom.js";
import { traceColor } from "./trace-color.js";
import { relativePhase } from "./phasor-practice-model.js";

/** Reads solved phasors. Does not run a solver, change probes, or write to state. */
export function createPhasorView(elements, state, parseNumeric, hasPendingInputs = () => false) {
  function compactNumber(value) {
    if (!Number.isFinite(value)) return "—";
    if (value === 0) return "0";
    return Number(value.toPrecision(6)).toString();
  }

  function phasorItems() {
    if (!state.phasorResult || state.settings.analysis !== "ac") return [];
    const point = state.phasorResult.points[0];
    return state.probes.map((probe) => {
      if (probe.kind === "voltage") {
        const node = probe.junctionId !== undefined
          ? state.phasorResult.topology.nodeIdByJunction?.[probe.junctionId]
          : state.phasorResult.topology.nodeIdByPin[`${probe.componentId}:${probe.pin}`];
        if (node === undefined) return null;
        return { probe, value: point.nodeVoltages[node], baseUnit: "V" };
      }
      const value = point.componentCurrents[probe.componentId];
      return value === undefined ? null : { probe, value, baseUnit: "A" };
    }).filter(Boolean);
  }

  function planeBaseMarkup(axis) {
    return `<rect width="300" height="220" class="phasor-surface"/><circle class="phasor-grid-line" cx="150" cy="105" r="70" fill="none"/><line class="phasor-axis-line" x1="45" y1="105" x2="255" y2="105"/><line class="phasor-axis-line" x1="150" y1="15" x2="150" y2="195"/><text class="phasor-axis-label" x="258" y="101">Re</text><text class="phasor-axis-label" x="155" y="15">Im</text><text class="phasor-scale-label" x="246" y="118" text-anchor="end">+${compactNumber(axis.maximum)} ${axis.unit}</text><text class="phasor-scale-label" x="54" y="118">−${compactNumber(axis.maximum)} ${axis.unit}</text><text class="phasor-scale-label" x="155" y="28">+j${compactNumber(axis.maximum)} ${axis.unit}</text><text class="phasor-scale-label" x="155" y="190">−j${compactNumber(axis.maximum)} ${axis.unit}</text><text class="phasor-scale-label" x="150" y="214" text-anchor="middle">공통 원 반경 = ${compactNumber(axis.maximum)} ${axis.unit} peak</text>`;
  }

  function renderComplexPlane(items, baseUnit, svgElement, valuesElement, unitElement) {
    const axis = phasorAxis(items.map((item) => item.value), baseUnit);
    unitElement.textContent = axis.unit;
    let markup = planeBaseMarkup(axis);
    if (!items.length) {
      svgElement.innerHTML = `${markup}<text class="phasor-axis-label" x="150" y="202" text-anchor="middle">선택된 ${baseUnit === "V" ? "전압" : "전류"} 프로브 없음</text>`;
      valuesElement.innerHTML = "";
      return;
    }
    for (const item of items) {
      if (item.value.re === 0 && item.value.im === 0) {
        markup += `<circle cx="150" cy="105" r="4" fill="${traceColor(item.probe.color)}"><title>크기 0 · 위상 미정</title></circle>`;
        continue;
      }
      const x = 150 + (item.value.re * axis.scale / axis.maximum) * 70;
      const y = 105 - (item.value.im * axis.scale / axis.maximum) * 70;
      const angle = Math.atan2(y - 105, x - 150);
      const left = { x: x - 9 * Math.cos(angle - .45), y: y - 9 * Math.sin(angle - .45) };
      const right = { x: x - 9 * Math.cos(angle + .45), y: y - 9 * Math.sin(angle + .45) };
      markup += `<line class="phasor-arrow" x1="150" y1="105" x2="${x}" y2="${y}" stroke="${traceColor(item.probe.color)}"/><polygon points="${x},${y} ${left.x},${left.y} ${right.x},${right.y}" fill="${traceColor(item.probe.color)}"/><circle cx="150" cy="105" r="3" fill="${traceColor(item.probe.color)}"/>`;
    }
    svgElement.innerHTML = markup;
    valuesElement.innerHTML = items.map((item) => {
      const rectangular = { re: item.value.re * axis.scale, im: item.value.im * axis.scale };
      const polar = phasorPolar(item.value);
      const phase = polar.angleDegrees === null ? "미정 (크기 0)" : `${compactNumber(polar.angleDegrees)}°`;
      const sign = rectangular.im < 0 ? "−" : "+";
      return `<div class="phasor-value" style="--trace-color:${traceColor(item.probe.color)}"><b>${escapeHtml(item.probe.label)}</b><span>${compactNumber(rectangular.re)} ${sign} j${compactNumber(Math.abs(rectangular.im))} ${axis.unit}</span><span>${compactNumber(polar.magnitude * axis.scale)} ${axis.unit} ∠ ${phase} · RMS ${compactNumber(peakToRms(polar.magnitude) * axis.scale)} ${axis.unit}</span></div>`;
    }).join("");
  }

  function renderPhasorTime(items) {
    const svg = elements["phasor-time-plot"];
    if (!state.phasorResult || !items.length) {
      svg.innerHTML = `<rect width="640" height="220" class="phasor-surface"/><text class="phasor-axis-label" x="320" y="112" text-anchor="middle">프로브를 선택하고 AC 해석을 실행하세요.</text>`;
      elements["phasor-time-units"].textContent = "시간 s";
      return;
    }
    const frequency = state.phasorResult.frequency;
    const voltageItems = items.filter((item) => item.baseUnit === "V");
    const currentItems = items.filter((item) => item.baseUnit === "A");
    const voltageAxis = phasorAxis(voltageItems.map((item) => item.value), "V");
    const currentAxis = phasorAxis(currentItems.map((item) => item.value), "A");
    const margin = { left: 70, right: 70, top: 24, bottom: 34 };
    const width = 640 - margin.left - margin.right;
    const height = 220 - margin.top - margin.bottom;
    let markup = `<rect width="640" height="220" class="phasor-surface"/>`;
    for (let tick = 0; tick <= 4; tick += 1) {
      const x = margin.left + width * tick / 4;
      markup += `<line class="phasor-grid-line" x1="${x}" y1="${margin.top}" x2="${x}" y2="${margin.top + height}"/><text class="phasor-axis-label" x="${x}" y="208" text-anchor="middle">${engineering((2 / frequency) * tick / 4, "s")}</text>`;
    }
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = margin.top + height * tick / 4;
      markup += `<line class="phasor-grid-line" x1="${margin.left}" y1="${y}" x2="${margin.left + width}" y2="${y}"/>`;
      if (voltageItems.length) markup += `<text class="phasor-scale-label" x="${margin.left - 7}" y="${y + 3}" text-anchor="end">${compactNumber(voltageAxis.ticks[tick])} ${voltageAxis.unit}</text>`;
      if (currentItems.length) markup += `<text class="phasor-scale-label" x="${margin.left + width + 7}" y="${y + 3}">${compactNumber(currentAxis.ticks[tick])} ${currentAxis.unit}</text>`;
    }
    markup += `<line class="phasor-axis-line" x1="${margin.left}" y1="${margin.top + height / 2}" x2="${margin.left + width}" y2="${margin.top + height / 2}"/>`;
    for (const item of items) {
      const axis = item.baseUnit === "V" ? voltageAxis : currentAxis;
      const coordinates = [];
      for (let index = 0; index <= 160; index += 1) {
        const fraction = index / 160;
        const time = (2 / frequency) * fraction;
        const value = phasorTimeValue(item.value, frequency, time) * axis.scale;
        coordinates.push([margin.left + width * fraction, margin.top + height / 2 - (value / axis.maximum) * height / 2]);
      }
      markup += `<path class="plot-line" stroke="${traceColor(item.probe.color)}" d="${coordinates.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("")}"/>`;
    }
    svg.innerHTML = markup;
    elements["phasor-time-units"].textContent = `f=${engineering(frequency, "Hz")} · t=0…2T · 좌 ${voltageItems.length ? voltageAxis.unit : "—"} / 우 ${currentItems.length ? currentAxis.unit : "—"}`;
  }

  function componentPhasorVoltage(component) {
    const first = state.phasorResult.topology.nodeIdByPin[`${component.id}:0`];
    const second = state.phasorResult.topology.nodeIdByPin[`${component.id}:1`];
    if (first === undefined || second === undefined) return null;
    const point = state.phasorResult.points[0];
    return {
      re: point.nodeVoltages[first].re - point.nodeVoltages[second].re,
      im: point.nodeVoltages[first].im - point.nodeVoltages[second].im,
    };
  }

  function renderImpedanceLearning() {
    const target = elements["impedance-learning"];
    if (!state.phasorResult) {
      target.textContent = "AC 해석을 실행한 뒤 회로에서 R, L 또는 C를 선택하세요.";
      return;
    }
    if (hasPendingInputs()) {
      target.textContent = "미확정 입력이 있습니다. 현재 입력을 확정하거나 버린 뒤 V/I와 이론 임피던스를 비교하세요.";
      return;
    }
    if (state.stale || state.runState?.status === "error") {
      target.innerHTML = "<strong>오래된 결과</strong><span>소자값 또는 설정이 바뀌었습니다. 해석을 다시 실행해야 V/I와 이론 임피던스를 비교할 수 있습니다.</span>";
      return;
    }
    const component = state.selected?.kind === "component" ? state.circuit.components.find((item) => item.id === state.selected.id) : null;
    if (!component || !["R", "L", "C"].includes(component.type)) {
      target.textContent = "회로에서 R, L 또는 C를 선택하면 그 소자의 양단 전압과 1→2 전류를 비교합니다.";
      return;
    }
    const voltage = componentPhasorVoltage(component);
    const current = state.phasorResult.points[0].componentCurrents[component.id];
    const measured = voltage && current ? divideComplex(voltage, current) : null;
    const theory = theoreticalImpedance(component.type, parseNumeric(component.props.value), state.phasorResult.frequency);
    const relation = component.type === "R" ? "전압과 전류가 동상" : component.type === "L" ? "전류가 전압보다 90° 지상" : "전류가 전압보다 90° 선행";
    const formula = component.type === "R" ? "Z_R = R" : component.type === "L" ? "Z_L = jωL" : "Z_C = 1/(jωC)";
    const complexText = (value) => value ? `${compactNumber(value.re)} ${value.im < 0 ? "−" : "+"} j${compactNumber(Math.abs(value.im))} Ω` : "정의 불가 (전류 0)";
    target.innerHTML = `<strong>${escapeHtml(component.props.ref ?? component.id)} · ${formula}</strong><span class="impedance-equation">계산 Z=(V₁−V₂)/I₁→₂ = ${complexText(measured)}</span><span>이론 Z = ${complexText(theory)} · ${relation}</span><span>소자 양단 전압 V₁−V₂를 사용했으며 접지 기준 한 노드 전압으로 대신하지 않았습니다.</span>`;
  }

  const comparisonA = document.getElementById("phase-reference-a");
  const comparisonB = document.getElementById("phase-reference-b");
  function renderComparison() {
    const output = document.getElementById("phase-comparison");
    if (!output) return;
    const items = phasorItems();
    if (hasPendingInputs() || state.stale || state.runState?.status === "error" || state.settings.analysis !== "ac" || !state.phasorResult) {
      output.textContent = "유효한 같은 주파수의 AC 결과가 있어야 위상차를 비교할 수 있습니다."; return;
    }
    const a = items.find(x => x.probe.key === comparisonA.value), b = items.find(x => x.probe.key === comparisonB.value);
    const phase = a && b ? relativePhase(a.value,b.value) : null;
    if (phase === null) { output.textContent = "비교할 두 프로브를 고르세요. 크기 0인 신호의 위상은 미정입니다."; return; }
    const relation = Math.abs(phase) < 1e-9 ? "동상" : Math.abs(Math.abs(phase)-180) < 1e-9 ? "역상 (180°)" : `A가 B보다 ${compactNumber(Math.abs(phase))}° ${phase > 0 ? "선행" : "지상"}`;
    output.textContent = `Δφ = arg(A) − arg(B) = ${compactNumber(phase)}° · ${relation}. 위상 비교만 하며 임피던스·전력을 계산하는 기능은 아닙니다.`;
  }
  comparisonA?.addEventListener("change", renderComparison);
  comparisonB?.addEventListener("change", renderComparison);
  function render() {
    const ac = state.settings.analysis === "ac", usable = ac && Boolean(state.phasorResult);
    const items = phasorItems();
    const notice = document.getElementById("phasor-validity");
    if (notice) {
      notice.dataset.status = hasPendingInputs() ? "pending" : state.runState?.status === "error" ? "error" : state.stale ? "stale" : usable ? "ready" : "empty";
      notice.textContent = hasPendingInputs() ? "미확정 입력이 있습니다. 아래는 마지막 확정값의 결과이며 현재 입력의 정답이 아닙니다. 입력을 확정하거나 버리세요." : state.runState?.status === "error" ? `해석 실패: ${state.runState.error?.message ?? "진단을 확인하세요"}. AC 설정 열기에서 오류를 확인하세요.` : !ac ? "현재 DC 또는 시간응답 설정입니다. AC 설정으로 전환해 해석하거나 복소수 연습 탭을 사용하세요."
        : state.stale ? "이전 해석 결과입니다. 회로나 설정이 변경되어 아래 벡터를 현재 정답으로 해석하면 안 됩니다. 다시 해석하세요."
        : usable ? `f=${engineering(state.phasorResult.frequency,"Hz")} · AC peak·cos 기준. V와 A는 각각 독립 눈금입니다.`
        : "AC 해석 전입니다. AC 크기와 페이저 주파수를 지정하고 해석하세요. SIN 진폭 설정과 별개입니다.";
    }
    renderComplexPlane(items.filter((item) => item.baseUnit === "V"), "V", elements["voltage-phasor-plot"], elements["voltage-phasor-values"], elements["voltage-plane-unit"]);
    renderComplexPlane(items.filter((item) => item.baseUnit === "A"), "A", elements["current-phasor-plot"], elements["current-phasor-values"], elements["current-plane-unit"]);
    renderPhasorTime(items);
    if (ac) renderImpedanceLearning();
    else elements["impedance-learning"].textContent = "AC 해석을 실행한 뒤 회로에서 R, L 또는 C를 선택하세요.";
    elements["phasor-summary"].textContent = usable
      ? `${engineering(state.phasorResult.frequency, "Hz")} 정확 계산 · ${items.length}개 trace · AC peak 복소 진폭`
      : "AC 해석을 실행하면 정확한 지정 주파수의 페이저를 계산합니다.";
    for (const [index, select] of [comparisonA, comparisonB].entries()) {
      if (!select) continue;
      const previous = select.value;
      // Rebuild only when probe identities/labels change, preserving focus and choice.
      const signature = JSON.stringify(items.map(x => [x.probe.key,x.probe.label]));
      if (select.dataset.signature !== signature) {
        select.replaceChildren(...items.map(item => {
          const option = document.createElement("option"); option.value = item.probe.key; option.textContent = item.probe.label ?? item.probe.key; return option;
        }));
        if (items.some(x=>x.probe.key===previous)) select.value = previous;
        else if (items.length) select.selectedIndex = Math.min(index,items.length-1);
        select.dataset.signature = signature;
      }
      select.disabled = !usable || hasPendingInputs() || state.stale || state.runState?.status === "error" || !items.length;
    }
    renderComparison();
  }

  return { render };
}
