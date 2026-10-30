// Netlist text (a SPICE subset) → a circuit laid out on the editor grid. The intended source is a photo of a lab-manual schematic read
// by Claude, which writes the parts and their nodes as text; the editor then places the parts and wires them. Pure, no DOM.
//
//   * 제목                      first comment line: the circuit's title; later comment lines: its description
//   V1 in 0 SIN(0 2.5 1k)       sources: DC v | SIN(offset amplitude freq [delay damping phase]) | PULSE(v1 v2 delay rise fall width period)
//   V2 in 0 DC 5 AC 1           … and AC magnitude [phase] for the AC analysis; I… is a current source (flows from n+ through it to n−)
//   R1 in out 1.5k              R, C, L: two nodes and a value (k, meg, m, u, n, p; units like Ω F H are allowed after the number)
//   D1 anode cathode            diode
//   U1 plus minus out           ideal op amp (+ input, − input, output)
//   .tran 10u 5m                transient: step, stop [, start]
//   .ac dec 50 10 100k          AC sweep: points per decade, start, stop [Hz]
//   .probe V(out) I(R1)         probes shown when the circuit opens
// Node 0 (or gnd) is ground. Each grounded pin gets its own ground symbol right below it, the way lab schematics draw it.
import { parseValue, componentDefaults, pinCount } from "./circuit-engine.js";
import { CURRENT_GEOMETRY_VERSION, pinPosition } from "./circuit-geometry.js";
import { rerouteWires, pinOutwardDirection } from "./wire-router.js";

export const NETLIST_MAX_CHARS = 20000;
export const NETLIST_MAX_PARTS = 60;
const GROUND = new Set(["0", "gnd", "GND", "Gnd"]);
const isGround = (node) => GROUND.has(node);
const TYPES = { R: "R", C: "C", L: "L", V: "V", I: "I", D: "D", U: "OPAMP_IDEAL" };
const NAMES = { R: "저항", C: "커패시터", L: "인덕터", V: "전압원", I: "전류원", D: "다이오드", U: "이상 OP AMP" };
const UNSUPPORTED = { Q: "트랜지스터(BJT)", M: "MOSFET", J: "JFET", X: "부회로(X)", E: "종속 전압원(E)", G: "종속 전류원(G)", F: "종속 전류원(F)", H: "종속 전압원(H)", K: "결합 인덕터(K)", T: "전송선(T)", S: "스위치(S)", W: "스위치(W)" };

/** A value as the editor reads it: "1.5kΩ" → "1.5k", "11nF" → "11n", "10mH" → "10m"; null when it cannot be read. */
export function editorValue(raw, unit) {
  // A unit letter goes only in its own case: "11nF" → "11n", but "10f" stays femto (SPICE), never 10 farad.
  const text = String(raw ?? "").trim().replace(/[Ωω]$/u, "").replace(/ohms?$/i, "").replace(unit ? new RegExp(unit + "$") : /$^/, "");
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?M$/.test(text)) return null; // "1M": milli in SPICE, mega elsewhere — ask for "1meg" or "1m"
  try { parseValue(text); return text; } catch { return null; }
}
const valueOf = (text) => parseValue(text);

/** Split "SIN(0 2.5 1k) AC 1" into ["SIN", ["0","2.5","1k"], "AC", "1"]-like tokens: parentheses keep their arguments together. */
function tokens(line) {
  const out = [];
  const re = /([A-Za-z_][\w.+-]*)\s*\(([^)]*)\)|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] ? { name: m[1].toUpperCase(), args: m[2].split(/[\s,]+/).filter(Boolean) } : m[3]);
  return out;
}

function sourceProps(rest, unit, error, warn) {
  const props = {};
  let modeSet = false;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    const num = (text, what) => { const v = editorValue(text, unit); if (v === null) error(what + ' 값 "' + text + '"을(를) 읽을 수 없습니다.'); return v ?? "0"; };
    if (typeof t === "object") {
      if (t.name === "SIN") {
        const [offset = "0", amplitude = "0", frequency = "60", delay = "0", damping = "0", phase = "0"] = t.args;
        if (t.args.length < 3) error("SIN(오프셋 진폭 주파수)의 세 값이 필요합니다.");
        if (Number(parseValue(editorValue(delay, "s") ?? "0")) !== 0 || Number(parseValue(editorValue(damping, "") ?? "0")) !== 0) warn("SIN의 지연·감쇠는 편집기에 없어 0으로 읽었습니다.");
        Object.assign(props, { mode: "SIN", offset: num(offset, "SIN 오프셋"), amplitude: num(amplitude, "SIN 진폭"), frequency: num(frequency, "SIN 주파수"), phase: num(phase, "SIN 위상") });
      } else if (t.name === "PULSE") {
        const [v1 = "0", v2 = "1", delay = "0", rise = "0", fall = "0", width = "1", period = "2"] = t.args;
        if (t.args.length < 7) error("PULSE(V1 V2 지연 상승 하강 폭 주기)의 일곱 값이 모두 필요합니다.");
        Object.assign(props, { mode: "PULSE", pulseV1: num(v1, "PULSE V1"), pulseV2: num(v2, "PULSE V2"), pulseDelay: num(delay, "PULSE 지연"), pulseRise: num(rise, "PULSE 상승"),
          pulseFall: num(fall, "PULSE 하강"), pulseWidth: num(width, "PULSE 폭"), pulsePeriod: num(period, "PULSE 주기") });
      } else error(t.name + "(…) 꼴의 전원은 지원하지 않습니다. DC, SIN(…), PULSE(…), AC를 쓰세요.");
      modeSet = true;
      continue;
    }
    const word = t.toUpperCase();
    if (word === "DC") { Object.assign(props, { mode: props.mode ?? "DC", dc: num(rest[++i], "DC") }); modeSet = true; }
    else if (word === "AC") {
      props.acMagnitude = num(rest[++i] ?? "1", "AC 크기");
      if (rest[i + 1] !== undefined && typeof rest[i + 1] === "string" && editorValue(rest[i + 1], "") !== null) props.acPhase = num(rest[++i], "AC 위상");
    } else if (!modeSet && editorValue(t, unit) !== null) { Object.assign(props, { mode: "DC", dc: num(t, "DC") }); modeSet = true; }
    else error('"' + t + '"을(를) 읽을 수 없습니다.');
  }
  // Every value the editor would otherwise fill from its own defaults (dc 5, AC 1) is set here, as SPICE reads the line: "AC 1" alone is a
  // 0 V source with an AC part, the DC value of a SIN/PULSE source is its value at t = 0, and no AC part means AC 0.
  if (!props.mode) props.mode = "DC";
  if (props.dc === undefined) props.dc = props.mode === "SIN" ? props.offset : props.mode === "PULSE" ? props.pulseV1 : "0";
  if (props.acMagnitude === undefined) props.acMagnitude = "0";
  if (props.acPhase === undefined) props.acPhase = "0";
  return props;
}

/**
 * Text → { title, description, parts: [{ ref, type, kind, nodes, props, line }], settings, probes: [{ kind, node | ref }], errors, warnings }.
 * Every problem names its line; nothing is guessed silently.
 */
export function parseNetlist(text) {
  const out = { title: "", description: [], parts: [], settings: null, probes: [], errors: [], warnings: [] };
  if (typeof text !== "string" || !text.trim()) { out.errors.push("넷리스트가 비어 있습니다."); return out; }
  if (text.length > NETLIST_MAX_CHARS) { out.errors.push("넷리스트는 " + NETLIST_MAX_CHARS + "자 이내여야 합니다."); return out; }
  const refs = new Set();
  // A whole chat answer may be pasted: with ``` fences only the first block is read (the words around it are the model's notes) and the
  // other lines count as blank, so line numbers still match the pasted text. "+" continuation lines join the line above.
  let lines = text.split(/\r?\n/);
  const fences = lines.map((l, i) => (/^\s*```/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (fences.length >= 2) {
    const [open, close] = fences;
    lines = lines.map((l, i) => (i > open && i < close ? l : ""));
    if (fences.length > 3) out.warnings.push("코드 블록이 여러 개라 첫 블록(" + (open + 1) + "~" + (close + 1) + "행)만 읽었습니다. 다른 회로는 그 블록만 따로 붙여 넣으세요.");
  } else if (fences.length === 1) lines = lines.map((l, i) => (i === fences[0] ? "" : l));
  const joined = [];
  lines.forEach((raw, index) => {
    const line = raw.replace(/;.*$/, "").trim();
    if (line.startsWith("+") && joined.length) joined[joined.length - 1].text += " " + line.slice(1);
    else joined.push({ text: line, raw: raw.trim(), number: index + 1 });
  });
  for (const { text: line, raw, number } of joined) {
    const error = (message) => out.errors.push(number + "행: " + message);
    if (!line) continue;
    if (line.startsWith("*")) {
      const comment = raw.replace(/^\*+\s*/, "");
      if (!out.title && comment) out.title = comment.slice(0, 120); else if (comment) out.description.push(comment);
      continue;
    }
    if (line.startsWith(".")) {
      const [word, ...args] = line.split(/\s+/), cmd = word.toLowerCase();
      if (cmd === ".end" || cmd === ".op") continue;
      if (cmd === ".tran") {
        const [step, stop, start = "0"] = args.map((a) => editorValue(a, "s"));
        if (!step || !stop) { error(".tran 간격과 끝 시간을 읽을 수 없습니다. 예: .tran 10u 5m"); continue; }
        if (!(valueOf(step) > 0 && valueOf(stop) > valueOf(start ?? "0"))) { error(".tran 간격은 0보다 크고 끝 시간은 시작보다 커야 합니다."); continue; }
        if (valueOf(stop) / valueOf(step) > 20000) { error(".tran 점이 2만 개를 넘습니다(끝 ÷ 간격). 간격을 늘리세요."); continue; }
        out.settings = { analysis: "transient", step, end: stop, start: start ?? "0" };
      } else if (cmd === ".ac") {
        const [sweep, points, fstart, fstop] = args;
        if (String(sweep).toLowerCase() !== "dec") { error(".ac는 dec 스윕만 지원합니다. 예: .ac dec 50 10 100k"); continue; }
        const f1 = editorValue(fstart, "Hz"), f2 = editorValue(fstop, "Hz"), n = Number(points);
        if (!f1 || !f2 || !Number.isInteger(n) || n < 1) { error(".ac 값을 읽을 수 없습니다. 예: .ac dec 50 10 100k"); continue; }
        if (!(valueOf(f1) > 0 && valueOf(f2) > valueOf(f1))) { error(".ac 시작 주파수는 0보다 크고 끝 주파수보다 작아야 합니다."); continue; }
        out.settings = { analysis: "ac", pointsPerDecade: String(Math.min(n, 200)), startFrequency: f1, endFrequency: f2 };
      } else if (cmd === ".probe" || cmd === ".print" || cmd === ".plot") {
        for (const m of line.matchAll(/\b([VI])\(\s*([^)]+?)\s*\)/gi)) {
          const args = m[2].split(/[\s,]+/).filter(Boolean);
          if (m[1].toUpperCase() === "I") { out.probes.push({ kind: "current", ref: args[0].toUpperCase() }); continue; }
          if (args.length > 1) out.warnings.push(number + "행: V(" + args.join(",") + ")는 두 노드의 전압을 각각 잽니다(차이는 커서로 읽으세요).");
          for (const node of args) out.probes.push({ kind: "voltage", node: node.toLowerCase() });
        }
      } else out.warnings.push(number + "행: " + word + " 지시문은 무시했습니다.");
      continue;
    }
    const parts = tokens(line), ref = String(parts[0]).toUpperCase(), letter = ref[0];
    if (UNSUPPORTED[letter]) { error(UNSUPPORTED[letter] + "는 편집기에 없는 부품입니다 (" + ref + ")."); continue; }
    if (!TYPES[letter]) { error('"' + ref + '"의 부품 종류를 알 수 없습니다. R, C, L, V, I, D, U로 시작해야 합니다.'); continue; }
    if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(ref)) { error('부품 이름 "' + ref + '"은(는) 글자로 시작하는 16자 이내 영문·숫자여야 합니다.'); continue; }
    if (refs.has(ref)) { error(ref + "이(가) 두 번 나옵니다."); continue; }
    // Node names are not case sensitive (SPICE): IN and in are one node.
    const nodeCount = letter === "U" ? 3 : 2, nodes = parts.slice(1, 1 + nodeCount).map((n) => (typeof n === "string" ? n.toLowerCase() : n));
    if (nodes.length < nodeCount || nodes.some((n) => typeof n !== "string")) { error(ref + "에 연결 노드 " + nodeCount + "개가 필요합니다."); continue; }
    if (letter === "U" && parts.length > 4) { error(ref + "는 +입력 −입력 출력 세 노드만 씁니다. ±Vcc 전원 핀은 빼세요 (이상 OP AMP)."); continue; }
    if (nodeCount === 2 && nodes[0] === nodes[1]) out.warnings.push(number + "행: " + ref + "의 두 단자가 같은 노드(" + nodes[0] + ")라 단락된 부품입니다.");
    let rest = parts.slice(1 + nodeCount);
    // "1.5 k" or "11 nF" (a space before the prefix, as photos print "1.5 kΩ") is one value, never 1.5 Ω and a stray "k".
    if (typeof rest[0] === "string" && typeof rest[1] === "string" && rest[1] && /^(meg|[kmunpfgtKMUNPFGT]|µ)?(Ω|ohms?|F|H|V|A)?$/u.test(rest[1])) rest = [rest[0] + rest[1], ...rest.slice(2)];
    const unit = { R: "", C: "F", L: "H", V: "V", I: "A" }[letter] ?? "";
    let props = {};
    if (letter === "R" || letter === "C" || letter === "L") {
      const value = editorValue(rest[0], unit);
      if (value === null) { error(ref + ' 값 "' + (rest[0] ?? "") + '"을(를) 읽을 수 없습니다. 예: 1.5k, 11n, 10m (메가는 meg)'); continue; }
      if (!(valueOf(value) > 0)) { error(ref + " 값은 0보다 커야 합니다."); continue; }
      props = { value };
      const extra = rest.slice(1).map((t) => (typeof t === "string" ? t : "")).join(" ").replace(/\s*=\s*/g, "=").trim();
      const ic = /^ic=(\S+)$/i.exec(extra);
      if (ic && letter !== "R") {
        const v = editorValue(ic[1], letter === "C" ? "V" : "A");
        if (v === null) { error(ref + ' 초기값 "' + ic[1] + '"을(를) 읽을 수 없습니다.'); continue; }
        props.ic = v;
      } else if (extra) out.warnings.push(number + "행: " + ref + ' 뒤의 "' + extra + '"은(는) 무시했습니다.');
    } else if (letter === "V" || letter === "I") {
      const before = out.errors.length;
      props = sourceProps(rest, unit, error, (m) => out.warnings.push(number + "행: " + ref + " " + m));
      if (out.errors.length > before) continue;
    }
    refs.add(ref);
    out.parts.push({ ref, type: TYPES[letter], kind: NAMES[letter], nodes, props, line: number });
  }
  if (out.parts.length > NETLIST_MAX_PARTS) out.errors.push("부품은 " + NETLIST_MAX_PARTS + "개까지 불러올 수 있습니다.");
  if (!out.parts.length && !out.errors.length) out.errors.push("부품 줄이 없습니다. 예: R1 1 2 1k");
  if (out.parts.length && !out.parts.some((p) => p.nodes.some(isGround))) out.errors.push("접지 노드(0)가 없습니다. 전원의 한쪽을 0에 연결하세요.");
  const nodes = new Set(out.parts.flatMap((p) => p.nodes));
  for (const probe of out.probes) {
    if (probe.kind === "voltage" && !nodes.has(probe.node)) out.warnings.push("프로브 V(" + probe.node + "): 그런 노드가 없어 뺐습니다.");
    if (probe.kind === "current" && !refs.has(probe.ref)) out.warnings.push("프로브 I(" + probe.ref + "): 그런 부품이 없어 뺐습니다.");
  }
  out.probes = out.probes.filter((p) => (p.kind === "voltage" ? nodes.has(p.node) && !isGround(p.node) : refs.has(p.ref)));
  // A node only one pin touches is open (a typo in a node name is the usual cause).
  for (const node of nodes) {
    if (isGround(node)) continue;
    const touches = out.parts.reduce((n, p) => n + p.nodes.filter((x) => x === node).length, 0);
    if (touches === 1) out.warnings.push("노드 " + node + "에 단자가 하나뿐입니다(열린 끝). 노드 이름에 오타가 없는지 확인하세요.");
  }
  return out;
}

// ---- layout -------------------------------------------------------------------------------------------------------------------------
const TOP = 140, MID = 260, OPAMP_Y = 480, COLUMN = 200, SHUNT = 120, ROW = 100, LEFT = 100;

/**
 * Parsed netlist → { circuit, settings, probes: [{ kind, componentId, pin }], title, subtitle }. Layout: the main source stands at the
 * left; nodes follow it left to right in the order the parts reach them (breadth first from the source); a part from a node to ground
 * stands under that node; a part between two nodes lies on the top row between them (parallel or skipping ones on rows above); op amps
 * sit on a row below. Wires join the pins of each node along a shortest tree and are then routed around the parts like "배선 정리".
 */
export function layoutNetlist(parsed) {
  if (parsed.errors.length) throw new RangeError(parsed.errors[0]);
  const parts = parsed.parts;
  const grounded = (p) => p.nodes.length === 2 && (isGround(p.nodes[0]) !== isGround(p.nodes[1]));
  const source = parts.find((p) => (p.type === "V" || p.type === "I") && grounded(p)) ?? parts.find((p) => p.type === "V" || p.type === "I") ?? null;
  // Node order: breadth first from the source's live node over every part.
  const order = [], seen = new Set();
  const visit = (start) => {
    if (isGround(start) || seen.has(start)) return;
    const queue = [start]; seen.add(start);
    while (queue.length) {
      const node = queue.shift(); order.push(node);
      for (const p of parts) if (p.nodes.includes(node)) for (const n of p.nodes) if (!isGround(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  };
  if (source) visit(source.nodes.find((n) => !isGround(n)) ?? source.nodes[0]);
  for (const p of parts) for (const n of p.nodes) visit(n);
  const index = new Map(order.map((n, i) => [n, i]));
  // Parts per role.
  const shunts = new Map(order.map((n) => [n, []]));
  const series = [], opamps = [], floating = [];
  for (const p of parts) {
    if (p.type === "OPAMP_IDEAL") opamps.push(p);
    else if (grounded(p)) shunts.get(p.nodes.find((n) => !isGround(n))).push(p);
    else if (p.nodes.every(isGround)) floating.push(p);
    else series.push(p);
  }
  // No AC part anywhere: the main source carries AC 1 so a later switch to the AC analysis has an input (only that one: SPICE semantics).
  const anyAc = parts.some((p) => (p.type === "V" || p.type === "I") && valueOf(p.props.acMagnitude ?? "0") !== 0);
  const propsOf = (p) => (p === source && !anyAc ? { ...p.props, acMagnitude: p.type === "V" ? "1" : "1m" } : p.props);
  if (source && grounded(source)) { const list = shunts.get(source.nodes.find((n) => !isGround(n))); list.splice(list.indexOf(source), 1); list.unshift(source); }
  // Node x positions: each node's shunts side by side, then a gap for the part to the next node.
  const left = new Map(), right = new Map();
  let x = LEFT;
  for (const node of order) {
    left.set(node, x);
    x += SHUNT * Math.max(0, shunts.get(node).length - 1);
    right.set(node, x);
    x += COLUMN;
  }
  const components = [];
  const place = (p, cx, cy, rotation) => { components.push({ id: p.ref, type: p.type, x: cx, y: cy, rotation, props: { ...componentDefaults(p.type, Number(p.ref.match(/\d+/)?.[0] ?? 1)), ...propsOf(p), ref: p.ref } }); };
  for (const node of order) shunts.get(node).forEach((p, k) => {
    // Vertical, live pin up (pin 0 is at the top at 90°, at the bottom at 270°).
    place(p, left.get(node) + SHUNT * k, MID, isGround(p.nodes[0]) ? 270 : 90);
  });
  // Series parts: rows of [from, to] spans so two parts never share a row segment.
  const rows = [];
  const freeRow = (a, b) => {
    for (let r = 0; ; r++) {
      rows[r] ??= [];
      if (rows[r].every(([s, e]) => b <= s || a >= e)) { rows[r].push([a, b]); return r; }
    }
  };
  for (const p of series.sort((s, t) => Math.abs(index.get(s.nodes[0]) - index.get(s.nodes[1])) - Math.abs(index.get(t.nodes[0]) - index.get(t.nodes[1])))) {
    const [ia, ib] = p.nodes.map((n) => index.get(n)), lo = Math.min(ia, ib), hi = Math.max(ia, ib);
    const from = right.get(order[lo]), to = left.get(order[hi]);
    const r = freeRow(lo, hi);
    place(p, Math.round((from + to) / 2 / 20) * 20, TOP - ROW * r, ia <= ib ? 0 : 180);
  }
  opamps.forEach((p, k) => {
    const live = p.nodes.filter((n) => !isGround(n)).map((n) => left.get(n));
    const cx = live.length ? Math.round((Math.max(...live) - 60) / 20) * 20 : LEFT + 200 * k;
    place(p, Math.max(LEFT + 100, cx) + 40 * k, OPAMP_Y + 160 * k, 0);
  });
  floating.forEach((p, k) => place(p, LEFT + SHUNT * k, OPAMP_Y + 240, 0));
  // Ground symbols under every grounded pin; then each node's pins joined along a shortest tree.
  const byId = new Map(components.map((c) => [c.id, c]));
  const pinsOf = new Map();
  let groundCount = 0;
  const wires = [];
  const wire = (a, b) => wires.push({ id: "W" + (wires.length + 1), a, b });
  for (const p of parts) {
    const c = byId.get(p.ref);
    p.nodes.forEach((node, pin) => {
      const at = pinPosition(c, pin);
      if (isGround(node)) {
        groundCount += 1;
        // The symbol stands 80 px out along the pin's own direction, turned so its pin faces it (under a downward pin, upright): a ground
        // dropped straight down from a sideways pin (an op amp's + input) would land on the pin below it.
        const dir = pinOutwardDirection(c, pin), step = [[1, 0], [0, 1], [-1, 0], [0, -1]][dir ?? 1];
        const g = { id: "G" + groundCount, type: "GND", x: Math.round(at.x / 20) * 20 + 80 * step[0], y: Math.round(at.y / 20) * 20 + 80 * step[1], rotation: [270, 0, 90, 180][dir ?? 1],
          props: { ...componentDefaults("GND"), ref: "GND" } };
        components.push(g);
        wire({ componentId: c.id, pin }, { componentId: g.id, pin: 0 });
      } else {
        if (!pinsOf.has(node)) pinsOf.set(node, []);
        pinsOf.get(node).push({ endpoint: { componentId: c.id, pin }, at });
      }
    });
  }
  for (const pins of pinsOf.values()) {
    // Prim's tree on Manhattan distance: short, and no pin is joined to a far one when a near one exists.
    const inTree = [pins[0]], rest = pins.slice(1);
    while (rest.length) {
      let best = null;
      for (const a of inTree) for (const b of rest) {
        const d = Math.abs(a.at.x - b.at.x) + Math.abs(a.at.y - b.at.y);
        if (!best || d < best.d) best = { a, b, d };
      }
      wire(best.a.endpoint, best.b.endpoint);
      inTree.push(best.b); rest.splice(rest.indexOf(best.b), 1);
    }
  }
  const circuit = { version: 1, geometryVersion: CURRENT_GEOMETRY_VERSION, components, wires, junctions: [] };
  rerouteWires(circuit, wires.map((w) => w.id), { fresh: true });
  // Probes: V(node) on the first pin of that node, I(R1) on the part. Without .probe: the source's node and the last node (the input
  // and the output a lab sheet asks to compare).
  const probes = [];
  const wanted = parsed.probes.length ? parsed.probes : [...new Set([order[0], order[order.length - 1]].filter(Boolean))].map((node) => ({ kind: "voltage", node }));
  for (const probe of wanted) {
    if (probe.kind === "current") { if (pinCount(byId.get(probe.ref)?.type) > 0) probes.push({ kind: "current", componentId: probe.ref }); continue; }
    const first = pinsOf.get(probe.node)?.[0]?.endpoint;
    if (first) probes.push({ kind: "voltage", componentId: first.componentId, pin: first.pin });
  }
  const unique = probes.filter((p, i) => probes.findIndex((q) => q.kind === p.kind && q.componentId === p.componentId && q.pin === p.pin) === i).slice(0, 8);
  return { circuit, settings: parsed.settings ?? inferredSettings(parts), probes: unique, title: parsed.title || "넷리스트 회로", subtitle: parsed.description.join(" ").slice(0, 600) };
}

/** Without .tran/.ac: a periodic source gets a transient run of three periods (200 steps a period), anything else the DC analysis. */
export function inferredSettings(parts) {
  const periods = parts.filter((p) => p.type === "V" || p.type === "I").map((p) => (p.props.mode === "SIN" ? 1 / valueOf(p.props.frequency) : p.props.mode === "PULSE" ? valueOf(p.props.pulsePeriod) : null))
    .filter((t) => Number.isFinite(t) && t > 0);
  if (!periods.length) return { analysis: "dc" };
  const T = Math.max(...periods), short = (n) => String(Number(n.toPrecision(3)));
  return { analysis: "transient", start: "0", end: short(3 * T), step: short(Math.max(Math.min(...periods) / 200, 3 * T / 20000)) };
}

/** One line per part for the preview: "R1  저항  in – out  1.5 kΩ". */
export function describePart(p) {
  const unit = { R: "Ω", C: "F", L: "H" }[p.type];
  const si = (v, u) => {
    const n = valueOf(v), steps = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
    if (n === 0) return "0 " + u;
    const [s, prefix] = steps.find(([s]) => Math.abs(n) >= s * (1 - 1e-9)) ?? steps[steps.length - 1];
    return Number((n / s).toPrecision(4)) + " " + prefix + u;
  };
  let value = "";
  if (unit) value = si(p.props.value, unit);
  else if (p.type === "V" || p.type === "I") {
    const u = p.type === "V" ? "V" : "A", q = p.props;
    value = q.mode === "DC" && valueOf(q.dc) === 0 && q.acMagnitude !== undefined && valueOf(q.acMagnitude) !== 0 ? "AC 해석용 (직류 0)"
      : q.mode === "SIN" ? "정현파 진폭 " + si(q.amplitude, u) + " (" + si(Number(valueOf(q.amplitude)) * 2, u + "pp") + "), " + si(q.frequency, "Hz") + (Number(valueOf(q.offset)) ? ", 오프셋 " + si(q.offset, u) : "")
      : q.mode === "PULSE" ? "펄스 " + si(q.pulseV1, u) + " ↔ " + si(q.pulseV2, u) + ", 주기 " + si(q.pulsePeriod, "s") + " (" + si(1 / valueOf(q.pulsePeriod), "Hz") + "), 폭 " + si(q.pulseWidth, "s")
      : "DC " + si(q.dc, u);
    if (q.acMagnitude !== undefined && valueOf(q.acMagnitude) !== 0) value += " · AC " + si(q.acMagnitude, u);
  } else if (p.type === "OPAMP_IDEAL") value = "+ " + p.nodes[0] + ", − " + p.nodes[1] + ", 출력 " + p.nodes[2];
  const nodes = p.type === "OPAMP_IDEAL" ? "" : p.nodes.map((n) => (isGround(n) ? "접지" : n)).join(" – ");
  return [p.ref, p.kind, nodes, value].filter(Boolean).join("  ");
}

// The text a student pastes once into the Claude app (or a Claude project's instructions) so a photo comes back as this netlist.
export const CLAUDE_PROMPT = [
  "회로도 사진을 받으면 Circuit Lab에 붙여 넣을 넷리스트로 바꿔 주세요. 규칙:",
  "1. 회로 하나에 코드 블록 하나. 첫 줄은 '* 회로 이름', 다음 '* ' 줄들에 사진에 적힌 실험 조건(신호, 바꿔 끼우는 값, 잴 양).",
  "2. 부품 줄: 이름 노드… 값. 접지는 0, 다른 노드는 in, out, n1처럼 소문자 영문.",
  "   R1 in out 1.5k / C1 out 0 11n / L1 a b 10m / D1 애노드 캐소드 / U1 +입력 −입력 출력 (이상 OP AMP, ±Vcc 전원 핀과 그 전원은 쓰지 않음)",
  "3. 값은 띄어 쓰지 말고 접두사 k, meg, m, u, n, p (대문자 M은 쓰지 말 것). 값 뒤 단위 글자(Ω F H)는 생략.",
  "4. 함수 발생기: 정현파 진폭 = Vpp/2 (Vrms면 √2·Vrms, Vp면 그대로) → V1 in 0 SIN(오프셋 진폭 주파수), 예: 5Vpp 1kHz → SIN(0 2.5 1k).",
  "   구형파 ±Vpp/2 → PULSE(-2.5 2.5 0 1u 1u 0.5m 1m) (일곱 값 모두, 폭 = 주기/2). 0~5 V 구형파는 PULSE(0 5 0 1u 1u 0.5m 1m). 삼각파는 PULSE(-2.5 2.5 0 0.5m 0.5m 1n 1m).",
  "   직류는 V1 in 0 DC 5. 주파수 응답만 볼 때는 V1 in 0 AC 1.",
  "5. 해석: 시간 파형은 '.tran 간격 끝시간' (끝 = 주기의 3~5배, 간격 = 주기/200), 주파수 응답은 '.ac dec 50 시작 끝'.",
  "6. 계측기는 부품으로 넣지 말 것: 전압계·오실로스코프 채널은 '.probe V(노드)', 전류계는 그 자리를 그냥 한 노드로 잇고 '.probe I(부품)'.",
  "7. 값이 여러 개(예: C 11nF, 47nF)면 첫 값으로 쓰고 나머지는 '*' 줄에 적기. 사진에서 확실하지 않은 부분과 트랜지스터·스위치처럼 R C L V I D U가 아닌 부품은 코드 블록 밖에 적기(편집기는 첫 코드 블록만 읽음).",
].join("\n");
