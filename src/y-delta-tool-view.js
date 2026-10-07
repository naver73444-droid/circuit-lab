/**
 * "Y–Δ 변환" course tool: DOM and SVG. Everything is built once; later calls only change text and attributes, so focus, the slider
 * being dragged and the touch gesture are never lost. Colours come from the stylesheet tokens (no colour constants here).
 */
import { appendCourseMath } from "./course-math-view.js";
import { Y_DELTA_FORMULAS } from "./y-delta-model.js";
import { DIRECTIONS, SLIDER_STEPS } from "./y-delta-tool-model.js";
import { fmt, zText } from "./circuit-course-format.js";

const LEAD = {
  resistor: "세 저항을 바꾸면 반대쪽 회로가 바로 바뀝니다. Y와 Δ는 단자 A·B·C에서 보면 똑같이 동작합니다.",
  complex: "세 임피던스를 복소수로 쓰면(예: 3+j4, 5∠53.13°, j10) 같은 식으로 Y↔Δ를 바꿉니다. 단자 쌍에서 본 임피던스가 두 형태에서 같은지 아래에서 확인합니다.",
};

const SVG_NS = "http://www.w3.org/2000/svg";

// Corner and centre positions of the two diagrams (viewBox 800 x 380).
const Y = { N: [200, 215], A: [200, 70], B: [78, 320], C: [322, 320] };
const D = { A: [600, 70], B: [478, 320], C: [722, 320] };
const SYMBOL_HALF = 36;

// name → { from, to, label offset, anchor } for the three arms of the Y and the three sides of the Δ.
const RESISTORS = {
  RA: { from: Y.N, to: Y.A, dx: 30, dy: -2, anchor: "start" },
  RB: { from: Y.N, to: Y.B, dx: -36, dy: -6, anchor: "end" },
  RC: { from: Y.N, to: Y.C, dx: 36, dy: -6, anchor: "start" },
  RAB: { from: D.A, to: D.B, dx: -34, dy: -6, anchor: "end" },
  RBC: { from: D.B, to: D.C, dx: 0, dy: 36, anchor: "middle" },
  RCA: { from: D.C, to: D.A, dx: 34, dy: -6, anchor: "start" },
};

function svg(tag, attributes = {}, parent = null) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  parent?.append(element);
  return element;
}

function html(tag, attributes = {}, text = "", parent = null) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text) element.textContent = text;
  parent?.append(element);
  return element;
}

/** "RAB" → "R" + subscript "AB" (the visible text still reads RAB). */
function nameText(parent, name, attributes) {
  const text = svg("text", { class: "ydelta-name", ...attributes }, parent);
  text.append(document.createTextNode("R"));
  const sub = svg("tspan", { class: "ydelta-sub", dy: 4 }, text);
  sub.textContent = name.slice(1);
  return text;
}

function drawResistor(parent, name) {
  const { from, to, dx, dy, anchor } = RESISTORS[name];
  const group = svg("g", { "data-ydelta-resistor": name }, parent);
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const ux = (to[0] - from[0]) / length, uy = (to[1] - from[1]) / length;
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const cut = (distance) => [mid[0] + ux * distance, mid[1] + uy * distance];
  const near = cut(-SYMBOL_HALF), far = cut(SYMBOL_HALF);
  svg("line", { class: "ydelta-wire", x1: from[0], y1: from[1], x2: near[0], y2: near[1] }, group);
  svg("line", { class: "ydelta-wire", x1: far[0], y1: far[1], x2: to[0], y2: to[1] }, group);
  const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
  svg("path", { class: "ydelta-wire ydelta-body", transform: `translate(${mid[0]} ${mid[1]}) rotate(${angle})`, d: "M-36 0L-30 0L-25 -8L-15 8L-5 -8L5 8L15 -8L25 8L30 0L36 0" }, group);
  const x = mid[0] + dx, y = mid[1] + dy;
  nameText(group, name, { x, y, "text-anchor": anchor });
  const value = svg("text", { class: "ydelta-value", x, y: y + 17, "text-anchor": anchor, "data-ydelta-value": name }, group);
  value.textContent = "—";
  return group;
}

function drawCorner(parent, label, point, dx, dy) {
  svg("circle", { class: "ydelta-node", cx: point[0], cy: point[1], r: 5 }, parent);
  const text = svg("text", { class: "ydelta-corner", x: point[0] + dx, y: point[1] + dy, "text-anchor": "middle" }, parent);
  text.textContent = label;
}

export function createYDeltaToolView(host) {
  const doc = host.ownerDocument;
  host.replaceChildren();
  const root = html("div", { class: "ydelta-tool" }, "", host);
  const head = html("div", { class: "ydelta-head" }, "", root);
  html("h3", {}, "Y–Δ 변환", head);
  const lead = html("p", { class: "ydelta-lead" }, LEAD.resistor, head);

  const controls = html("div", { class: "ydelta-controls" }, "", root);
  const bar = html("div", { class: "ydelta-bar" }, "", controls);
  const direction = html("div", { class: "ydelta-direction", role: "group", "aria-label": "변환 방향" }, "", bar);
  const directionButtons = {};
  for (const [key, info] of Object.entries(DIRECTIONS)) {
    directionButtons[key] = html("button", { type: "button", "data-ydelta-direction": key, "aria-pressed": "false" }, info.label, direction);
  }
  // Values are resistances (log sliders, SI text) or complex impedances (text in the complex-calculator syntax, no sliders).
  const modeBox = html("div", { class: "ydelta-direction ydelta-mode", role: "group", "aria-label": "값의 종류" }, "", bar);
  const modeButtons = {
    resistor: html("button", { type: "button", "data-ydelta-mode": "resistor", "aria-pressed": "true" }, "저항", modeBox),
    complex: html("button", { type: "button", "data-ydelta-mode": "complex", "aria-pressed": "false" }, "복소 임피던스", modeBox),
  };

  const fields = html("div", { class: "ydelta-inputs" }, "", controls);
  const rows = [0, 1, 2].map((index) => {
    const row = html("div", { class: "ydelta-field", "data-ydelta-field": String(index) }, "", fields);
    const label = html("label", { for: `ydelta-text-${index}` }, "", row);
    const name = html("span", { class: "ydelta-field-name" }, "", label);
    const slider = html("input", { type: "range", min: 0, max: SLIDER_STEPS, step: 1, "data-ydelta-slider": String(index) }, "", row);
    const text = html("input", { type: "text", id: `ydelta-text-${index}`, inputmode: "text", autocomplete: "off", spellcheck: "false", "data-ydelta-text": String(index) }, "", row);
    const error = html("small", { class: "ydelta-error", role: "status", "data-ydelta-error": String(index) }, "", row);
    return { row, name, slider, text, error };
  });
  const examples = html("div", { class: "ydelta-examples", "data-ydelta-examples": "", role: "group", "aria-label": "복소 임피던스 예제", hidden: "" }, "", controls);

  const figure = html("figure", { class: "ydelta-figure" }, "", root);
  const canvas = svg("svg", { viewBox: "0 0 800 380", role: "img", "aria-labelledby": "ydelta-title ydelta-desc", class: "ydelta-svg", preserveAspectRatio: "xMidYMid meet" }, figure);
  const title = svg("title", { id: "ydelta-title" }, canvas);
  title.textContent = "Y 저항망과 Δ 저항망";
  const desc = svg("desc", { id: "ydelta-desc" }, canvas);
  const yGroup = svg("g", { class: "ydelta-shape", "data-ydelta-shape": "Y" }, canvas);
  const dGroup = svg("g", { class: "ydelta-shape", "data-ydelta-shape": "Δ" }, canvas);
  for (const name of ["RA", "RB", "RC"]) drawResistor(yGroup, name);
  for (const name of ["RAB", "RBC", "RCA"]) drawResistor(dGroup, name);
  drawCorner(yGroup, "A", Y.A, 0, -14); drawCorner(yGroup, "B", Y.B, -4, 28); drawCorner(yGroup, "C", Y.C, 4, 28);
  svg("circle", { class: "ydelta-node ydelta-center", cx: Y.N[0], cy: Y.N[1], r: 5 }, yGroup);
  drawCorner(dGroup, "A", D.A, 0, -14); drawCorner(dGroup, "B", D.B, -4, 28); drawCorner(dGroup, "C", D.C, 4, 28);
  const yTag = svg("text", { class: "ydelta-tag", x: 200, y: 26, "text-anchor": "middle", "data-ydelta-tag": "Y" }, yGroup);
  const dTag = svg("text", { class: "ydelta-tag", x: 600, y: 26, "text-anchor": "middle", "data-ydelta-tag": "Δ" }, dGroup);
  const arrow = svg("g", { class: "ydelta-arrow", "data-ydelta-arrow": "toDelta" }, canvas);
  const arrowAcross = svg("path", { d: "M366 190H434M418 174L434 190L418 206" }, arrow);
  const arrowDown = svg("path", { d: "M200 290V324M188 310L200 324L212 310", hidden: "" }, arrow);

  const read = html("p", { class: "ydelta-read", "data-ydelta-read": "" }, "", root); // not a live region: it changes on every slider step, so a screen reader would chatter while dragging
  const complexBox = html("div", { class: "ydelta-complex", "data-ydelta-complex": "", hidden: "" }, "", root); // result tables of the complex mode
  const math = html("div", { class: "ydelta-math", "data-ydelta-math": "" }, "", root);

  const details = html("details", { class: "ydelta-formulas", "data-ydelta-formulas": "" }, "", root);
  html("summary", {}, "변환식과 풀이 규칙", details);
  html("p", { class: "ydelta-note" }, "Y→Δ: 새 변은 (세 팔의 쌍곱 합)/(마주 보는 팔)입니다.", details);
  appendCourseMath(details, Y_DELTA_FORMULAS.toDelta.join(";") + ";S = R_A·R_B + R_B·R_C + R_C·R_A;R_AB = S/R_C");
  html("p", { class: "ydelta-note" }, "Δ→Y: 새 팔은 (닿는 두 변의 곱)/(세 변의 합)입니다.", details);
  appendCourseMath(details, Y_DELTA_FORMULAS.toY.join(";"));
  html("p", { class: "ydelta-note" }, "세 저항이 같으면 R_Δ = 3R_Y 입니다. 계산은 로그 영역에서 해서 10 Ω과 10 MΩ처럼 크기가 달라도 정확합니다.", details);

  const complexNote = html("p", { class: "ydelta-note", "data-ydelta-complexnote": "", hidden: "" }, "복소 임피던스에서도 식은 같습니다. 세 값이 같으면 Z_Δ = 3Z_Y 입니다. 분모(Σ 또는 S)가 0이면 등가 회로가 없어 이유를 알리고 마지막 결과를 유지합니다.", details);

  let mathKey = "";
  let stacked = false;
  let currentDirection = "toDelta";
  let letter = "R";

  /** Header row + body rows of text cells. */
  function makeTable(parent, headers, bodyRows) {
    const wrap = html("div", { class: "circuit-course-table-wrap" }, "", parent);
    const table = html("table", {}, "", wrap);
    const headRow = html("tr", {}, "", html("thead", {}, "", table));
    for (const header of headers) html("th", { scope: "col" }, header, headRow);
    const body = html("tbody", {}, "", table);
    for (const cells of bodyRows) {
      const tr = html("tr", {}, "", body);
      for (const cell of cells) html("td", {}, cell, tr);
    }
  }

  /** Side by side (wide) or one above the other (phone): the figure keeps legible text at 390 px. */
  function place() {
    canvas.setAttribute("viewBox", stacked ? "0 0 400 640" : "0 0 800 380");
    yGroup.setAttribute("transform", stacked ? "translate(40 0) scale(.8)" : "");
    dGroup.setAttribute("transform", stacked ? "translate(-280 322) scale(.8)" : "");
    arrowAcross.style.display = stacked ? "none" : "";
    arrowDown.style.display = stacked ? "" : "none";
    arrowDown.removeAttribute("hidden");
    const forward = currentDirection === "toDelta";
    arrow.setAttribute("transform", forward ? "" : stacked ? "translate(0 614) scale(1 -1)" : "translate(800 0) scale(-1 1)");
    canvas.dataset.layout = stacked ? "stacked" : "wide";
  }

  return {
    root,
    elements: { directionButtons, modeButtons, examples, complexBox, rows, read, math, desc, canvas },
    /** Direction and shape tags (input side is marked "입력", the other "결과"). */
    setDirection(key) {
      const info = DIRECTIONS[key];
      for (const [name, button] of Object.entries(directionButtons)) button.setAttribute("aria-pressed", String(name === key));
      root.dataset.direction = key;
      const input = info.inputShape === "Y" ? yGroup : dGroup, output = input === yGroup ? dGroup : yGroup;
      input.dataset.role = "input"; output.dataset.role = "output";
      yTag.textContent = `Y · ${key === "toDelta" ? "입력" : "결과"}`;
      dTag.textContent = `Δ · ${key === "toDelta" ? "결과" : "입력"}`;
      arrow.dataset.ydeltaArrow = key;
      currentDirection = key;
      place();
      info.inputs.forEach((name, index) => {
        rows[index].name.replaceChildren(doc.createTextNode(letter));
        const sub = doc.createElement("sub");
        sub.textContent = name.slice(1);
        rows[index].name.append(sub);
        rows[index].row.dataset.ydeltaName = name;
        rows[index].slider.setAttribute("aria-label", `${name} 저항 (로그 눈금, 10 Ω에서 10 MΩ)`);
        rows[index].text.setAttribute("aria-label", letter === "Z" ? `Z${name.slice(1)} 임피던스 (예: 3+j4, 5∠53.13°, j10)` : `${name} 저항 값 (예: 4.7k, 2.2meg, 330Ω)`);
      });
    },
    /** "resistor" | "complex": the names (R / Z), sliders, examples and the complex result tables follow the mode. Call setDirection afterwards. */
    setMode(next) {
      const complex = next === "complex";
      root.dataset.mode = next;
      for (const [key, button] of Object.entries(modeButtons)) button.setAttribute("aria-pressed", String(key === next));
      letter = complex ? "Z" : "R";
      rows.forEach((item) => { item.slider.hidden = complex; if (complex) item.text.setAttribute("placeholder", "예: 3+j4, 5∠53.13°, j10"); else item.text.removeAttribute("placeholder"); });
      canvas.querySelectorAll(".ydelta-name").forEach((element) => { element.firstChild.textContent = letter; });
      examples.hidden = !complex; complexBox.hidden = !complex; complexNote.hidden = !complex;
      lead.textContent = LEAD[next];
      mathKey = "";
    },
    /** Example buttons of the complex mode: [{ label }]. */
    setExamples(list) {
      examples.replaceChildren();
      list.forEach((item, index) => html("button", { type: "button", "data-ydelta-example": String(index) }, item.label, examples));
    },
    /** Complex mode: values on both diagrams, read line, formulas, the result table and the terminal-pair check (evaluateComplexTool). */
    showComplexEvaluation(evaluation) {
      for (const [name, text] of Object.entries(evaluation.texts)) {
        const element = canvas.querySelector(`[data-ydelta-value="${name}"]`);
        if (element) element.textContent = text.short;
      }
      read.textContent = evaluation.read;
      delete read.dataset.state;
      desc.textContent = evaluation.read;
      mathKey = "";
      math.replaceChildren();
      appendCourseMath(math, evaluation.math.general);
      html("p", { class: "ydelta-note", "data-ydelta-numeric": "" }, evaluation.math.numeric, math);
      complexBox.replaceChildren();
      html("h4", {}, "변환 결과", complexBox);
      makeTable(complexBox, ["값", "직교형 a+jb", "극형 r∠θ"], Object.keys(evaluation.outputs).map((key) => [`Z_${key.slice(1)}`, evaluation.texts[key].rect, evaluation.texts[key].polar]));
      html("h4", {}, "단자 쌍 등가 대조 (나머지 한 단자는 개방)", complexBox);
      makeTable(complexBox, ["단자 쌍", "Y에서 본 Z", "Δ에서 본 Z", "차이 |ΔZ|", "결과"], evaluation.pairs.map((p) => [p.pair, zText(p.fromY) + " Ω", zText(p.fromDelta) + " Ω", fmt(p.difference), p.pass ? "PASS" : "FAIL"]));
      const allPass = evaluation.pairs.every((p) => p.pass);
      html("p", { class: allPass ? "ydelta-note" : "ydelta-error", "data-ydelta-pairs": allPass ? "pass" : "fail" }, allPass ? "세 단자 쌍에서 본 임피던스가 Y와 Δ에서 같습니다." : "단자 쌍 임피던스가 다릅니다. 입력을 확인하세요.", complexBox);
    },
    /** Values on both diagrams, the read line and the math lines of one evaluation. */
    showEvaluation(evaluation) {
      for (const [name, text] of Object.entries(evaluation.texts)) {
        const element = canvas.querySelector(`[data-ydelta-value="${name}"]`);
        if (element) element.textContent = text;
      }
      read.textContent = evaluation.read;
      delete read.dataset.state;
      desc.textContent = evaluation.read;
      const key = `${evaluation.direction}|${evaluation.math.general}|${evaluation.math.numeric}`;
      if (key !== mathKey) {
        mathKey = key;
        math.replaceChildren();
        appendCourseMath(math, `${evaluation.math.general};${evaluation.math.numeric}`);
      }
    },
    setStacked(value) { stacked = Boolean(value); place(); },
    /** Knob position and the value a screen reader says for it ("3 kΩ"; the position alone is a meaningless 0…1000). */
    showSlider(index, position, valueText) {
      rows[index].slider.value = String(position);
      if (valueText !== undefined) rows[index].slider.setAttribute("aria-valuetext", valueText);
    },
    /** Only the spoken value: used while the knob itself is being dragged (moving it from here would fight the pointer). */
    showSliderValueText(index, valueText) { rows[index].slider.setAttribute("aria-valuetext", valueText); },
    /** A reason that is not about one field (e.g. the direction switch failed) goes to the read line until the next evaluation replaces it. */
    showNotice(text) {
      read.textContent = text;
      read.dataset.state = "notice";
    },
    showText(index, text) { rows[index].text.value = text; },
    showError(index, message) {
      rows[index].error.textContent = message ?? "";
      if (message) rows[index].text.setAttribute("aria-invalid", "true"); else rows[index].text.removeAttribute("aria-invalid");
    },
    clear() { host.replaceChildren(); },
  };
}
