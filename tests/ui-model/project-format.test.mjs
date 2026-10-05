import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CircuitError, buildTopology, deserializeCircuit, serializeCircuit, simulateDC } from "../../src/circuit-engine.js";
import { cloneExample } from "../../src/examples.js";
import { deserializeProject, serializeProject } from "../../src/project-format.js";
import { isSafeColor, escapeHtml } from "../../src/safe-dom.js";

describe("basic analyses", () => {
  function nodeFor(result, componentId, pin) {
    return result.topology.nodeIdByPin[`${componentId}:${pin}`];
  }

  function voltage(result, pointIndex, componentId, pin = 0) {
    return result.points[pointIndex].nodeVoltages[nodeFor(result, componentId, pin)];
  }

  test("JSON 저장·불러오기 round-trip", () => {
    const { circuit } = cloneExample("divider");
    const restored = deserializeCircuit(serializeCircuit(circuit));
    assert.deepEqual(restored, circuit);
  });

  test("프로젝트 저장 경로는 분석 설정 전체를 보존한다", () => {
    const { circuit } = cloneExample("rc-lowpass");
    const settings = {
      analysis: "ac",
      start: "125u",
      end: "9m",
      step: "7u",
      startFrequency: "37Hz",
      endFrequency: "73kHz",
      pointsPerDecade: "17",
    };
    const text = serializeProject({ title: "설정 보존", subtitle: "검증", circuit, settings, probes: [] });
    const restored = deserializeProject(text, { analysis: "dc" });
    assert.deepEqual(restored.settings, settings);
    assert.deepEqual(restored.circuit, circuit);
  });

  test("접지 없는 작성 중 회로도 JSON에서 다시 연다", () => {
    const circuit = { version: 1, components: [{ id: "R1", type: "R", props: { ref: "R1", value: "1k" } }], wires: [] };
    assert.deepEqual(deserializeCircuit(serializeCircuit(circuit)), circuit);
    assert.throws(() => simulateDC(circuit), (error) => error instanceof CircuitError && error.code === "NO_GROUND");
  });

  test("JSON 값 검증은 해석 시점까지 유예한다", () => {
    const { circuit } = cloneExample("divider");
    circuit.components.find((component) => component.id === "R1").props.value = "banana";
    const restored = deserializeCircuit(serializeCircuit(circuit));
    assert.equal(restored.components.find((component) => component.id === "R1").props.value, "banana");
    assert.throws(() => simulateDC(restored), (error) => error instanceof CircuitError && error.code === "INVALID_VALUE");
  });

  test("JSON 구조 검증은 존재하지 않는 핀을 거부한다", () => {
    const malformed = {
      version: 1,
      components: [{ id: "R1", type: "R", props: { ref: "R1", value: "1k" } }],
      wires: [{ id: "W1", a: { componentId: "R1", pin: 0 }, b: { componentId: "NOPE", pin: 0 } }],
    };
    assert.throws(() => deserializeCircuit(JSON.stringify(malformed)), (error) => error instanceof CircuitError && error.code === "BAD_WIRE");
  });

  test("프로젝트는 단일 페이저 주파수와 probe 색을 저장·복원한다", () => {
    const { circuit } = cloneExample("rc-lowpass");
    const settings = { analysis: "ac", startFrequency: "10", endFrequency: "100k", pointsPerDecade: "30", phasorFrequency: "159.155Hz" };
    const probes = [{ key: "V:C1:0", kind: "voltage", componentId: "C1", pin: 0, label: "V(C1.1)", color: "#52e0b7" }];
    const restored = deserializeProject(serializeProject({ title: "phasor", subtitle: "round-trip", circuit, settings, probes }));
    assert.deepEqual(restored.settings, settings);
    assert.deepEqual(restored.probes, probes);
  });

  test("junction version 1 확장은 구버전을 보존하고 새 형식을 round-trip한다", () => {
    const legacy = { version: 1, components: [{ id: "G1", type: "GND", props: { ref: "GND" } }], wires: [] };
    assert.deepEqual(deserializeCircuit(serializeCircuit(legacy)), legacy);
    const extended = { ...legacy, junctions: [{ id: "J1", x: 120, y: 80 }] };
    assert.deepEqual(deserializeCircuit(serializeCircuit(extended)), extended);
  });

  test("junction endpoint는 혼합·dangling 참조를 거부하고 pin namespace와 충돌하지 않는다", () => {
    const base = {
      version: 1,
      components: [
        { id: "junction", type: "GND", props: { ref: "GND" } },
        { id: "R1", type: "R", props: { ref: "R1", value: "1k" } },
      ],
      junctions: [{ id: "0", x: 100, y: 100 }],
      wires: [
        { id: "W1", a: { junctionId: "0" }, b: { componentId: "R1", pin: 0 } },
        { id: "W2", a: { componentId: "R1", pin: 1 }, b: { componentId: "junction", pin: 0 } },
      ],
    };
    const topology = buildTopology(base);
    assert.equal(topology.nodeIdByJunction["0"], topology.nodeIdByPin["R1:0"]);
    assert.notEqual(topology.nodeIdByJunction["0"], 0);
    for (const endpoint of [
      { junctionId: "0", componentId: "missing" },
      { junctionId: "missing" },
      { componentId: "R1" },
    ]) {
      const malformed = structuredClone(base);
      malformed.wires[0].a = endpoint;
      assert.throws(() => deserializeCircuit(JSON.stringify(malformed)), (error) => error instanceof CircuitError && error.code === "BAD_WIRE");
    }
  });

  test("프로젝트 프로브는 존재하는 pin 또는 junction만 참조한다", () => {
    const { circuit } = cloneExample("divider");
    circuit.junctions = [{ id: "J1", x: 360, y: 230 }];
    const valid = { key: "V:J:J1", kind: "voltage", junctionId: "J1", label: "V(J1)", color: "#52e0b7" };
    assert.deepEqual(deserializeProject(serializeProject({ circuit, settings: {}, probes: [valid] })).probes, [valid]);
    for (const probe of [
      { ...valid, junctionId: "missing" },
      { ...valid, componentId: "R1", pin: 0 },
      { ...valid, junctionId: undefined, componentId: "R1", pin: 9 },
      { ...valid, junctionId: undefined, kind: "current", componentId: "missing" },
      { ...valid, wireId: "missing" },
    ]) {
      assert.throws(
        () => deserializeProject(serializeProject({ circuit, settings: {}, probes: [probe] })),
        (error) => error instanceof CircuitError && error.code === "INVALID_FILE",
      );
    }
  });

  test("geometryVersion과 waypoint JSON은 round-trip하고 malformed 좌표는 거부한다", () => {
    const { circuit } = cloneExample("divider");
    circuit.wires[0].waypoints = [{ x: 220, y: 120 }, { x: 280, y: 120 }];
    assert.deepEqual(deserializeCircuit(serializeCircuit(circuit)), circuit);
    for (const waypoints of ["bad", [{ x: Number.NaN, y: 20 }], [{ x: 20 }]]) {
      const malformed = structuredClone(circuit);
      malformed.wires[0].waypoints = waypoints;
      assert.throws(() => deserializeCircuit(JSON.stringify(malformed)), (error) => error instanceof CircuitError && error.code === "BAD_WIRE");
    }
    const malformed = structuredClone(circuit);
    malformed.geometryVersion = 3;
    assert.throws(() => deserializeCircuit(JSON.stringify(malformed)), (error) => error instanceof CircuitError && error.code === "INVALID_FILE");
  });
});

describe("regressions", () => {
  const voltage = (result,id,pin=0) => result.points[0].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

  test('JSON rejects executable CSS/HTML color payloads',()=>{
    const c=cloneExample('divider').circuit; const p={key:'p',kind:'voltage',componentId:'R2',pin:0,label:'out',color:'red" onmouseover="window.__mark=1'};
    assert.throws(()=>deserializeProject(serializeProject({circuit:c,settings:{analysis:'dc'},probes:[p]})));
    for(const value of ['#123456','navy','rgb(20, 30, 40)','hsl(10, 40%, 30%)'])assert.equal(isSafeColor(value),true,value);
    for(const value of ['url(https://example.invalid)','red;position:fixed','red" onload="1'])assert.equal(isSafeColor(value),false);
  });

  test('HTML escaping preserves inert visible label text',()=>{
    assert.equal(escapeHtml('<x a="&\'">'),'&lt;x a=&quot;&amp;&#39;&quot;&gt;');
  });

  test('JSON rejects duplicate probe keys and invalid settings',()=>{
    const c=cloneExample('divider').circuit,p={key:'p',kind:'current',componentId:'R1',label:'I',color:'#123456'};
    assert.throws(()=>deserializeProject(serializeProject({circuit:c,settings:{analysis:'dc'},probes:[p,p]})));
    assert.throws(()=>deserializeProject(serializeProject({circuit:c,settings:{analysis:'alien'},probes:[]})));
  });
});

test("corrected coefficients save and restore without changing values", () => {
  const project = {
    title: "coefficients", subtitle: "controlled coefficients",
    circuit: {
      version: 2, geometryVersion: 1, wires: [], junctions: [],
      components: [
        { id: "E1", type: "VCVS", x: 100, y: 100, rotation: 0, props: { ref: "E1", g: "4" } },
        { id: "G1", type: "VCCS", x: 300, y: 100, rotation: 0, props: { ref: "G1", gm: "3mS" } },
      ],
    },
    settings: { analysis: "dc" }, probes: [],
  };
  const restored = deserializeProject(serializeProject(project));
  assert.equal(restored.circuit.components.find((item) => item.id === "E1").props.g, "4");
  assert.equal(restored.circuit.components.find((item) => item.id === "G1").props.gm, "3mS");
});

describe("controlled sources", () => {
  const project = {
    title: "VCVS/VCCS",
    subtitle: "controlled sources",
    circuit: {
      version: 2, geometryVersion: 2, junctions: [],
      components: [
        { id: "E1", type: "VCVS", x: 200, y: 200, rotation: 90, props: { ref: "E1", g: "4" } },
        { id: "G1", type: "VCCS", x: 400, y: 200, rotation: 0, props: { ref: "G1", gm: "3mS" } },
        { id: "GND", type: "GND", x: 300, y: 400, rotation: 0, props: { ref: "GND" } },
      ],
      wires: [
        { id: "W1", a: { componentId: "E1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
        { id: "W2", a: { componentId: "E1", pin: 3 }, b: { componentId: "GND", pin: 0 } },
        { id: "W3", a: { componentId: "G1", pin: 1 }, b: { componentId: "GND", pin: 0 } },
        { id: "W4", a: { componentId: "G1", pin: 3 }, b: { componentId: "GND", pin: 0 } },
      ],
    },
    settings: { analysis: "dc" },
    probes: [
      { key: "V:E1:0", kind: "voltage", componentId: "E1", pin: 0, label: "V(E1.p)", color: "#80bfff" },
      { key: "I:G1", kind: "current", componentId: "G1", label: "I(G1,p→n)", color: "#f5bc79" },
    ],
  };

  test("project v2 preserves controlled props and probe references", () => {
    const text = serializeProject(project); assert.equal(JSON.parse(text).version, 2);
    const restored = deserializeProject(text); assert.equal(restored.circuit.version, 2);
    assert.deepEqual(restored.circuit.components.find((item) => item.id === "E1").props, { ref: "E1", g: "4" });
    assert.deepEqual(restored.probes, project.probes);
    const legacy = structuredClone(project); legacy.circuit.components = legacy.circuit.components.filter((item) => item.type === "GND"); legacy.circuit.wires = []; legacy.probes = [];
    assert.equal(JSON.parse(serializeProject(legacy)).version, 1);
    const disguised = JSON.parse(text); disguised.version = 1;
    assert.throws(() => deserializeProject(JSON.stringify(disguised)), (error) => error.code === "INVALID_FILE");
  });
});

describe("project boundaries", () => {
  const readFixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

  const f0Text = readFixture("project-divider-f0.json");

  const f0 = deserializeProject(f0Text);

  const VABS = 1e-9, VREL = 1e-8, IABS = 1e-11, IREL = 1e-8;

  const close = (actual, expected, abs = VABS, rel = VREL) => {
    assert.ok(Number.isFinite(actual));
    assert.ok(Math.abs(actual - expected) <= abs + rel * Math.abs(expected), `${actual} != ${expected}`);
  };

  const node = (result, point, id, pin) => point.nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];

  test("malformed projects are atomically rejected at the parse boundary", () => {
    const base = JSON.parse(f0Text);
    const variants = [];
    const duplicateProbe = structuredClone(base); duplicateProbe.probes.push(structuredClone(duplicateProbe.probes[0])); variants.push(JSON.stringify(duplicateProbe));
    const stringInfinity = structuredClone(base); stringInfinity.circuit.components[0].x = "Infinity"; variants.push(JSON.stringify(stringInfinity));
    variants.push(f0Text.replace('"x": 120', '"x": 1e309'));
    const bogus = structuredClone(base); bogus.settings.analysis = "bogus"; variants.push(JSON.stringify(bogus));
    const settingsArray = structuredClone(base); settingsArray.settings = []; variants.push(JSON.stringify(settingsArray));
    const bananaStep = structuredClone(base); bananaStep.settings.analysis = "transient"; bananaStep.settings.step = "banana"; variants.push(JSON.stringify(bananaStep));
    const zeroStep = structuredClone(base); zeroStep.settings.analysis = "transient"; zeroStep.settings.step = "0"; variants.push(JSON.stringify(zeroStep));
    const infiniteFrequency = structuredClone(base); infiniteFrequency.settings.analysis = "ac"; infiniteFrequency.settings.startFrequency = "Infinity"; variants.push(JSON.stringify(infiniteFrequency));
    const state = { circuit: structuredClone(f0.circuit), settings: structuredClone(f0.settings), probes: structuredClone(f0.probes), draft: "banana", history: ["h"], future: ["f"] };
    const before = structuredClone(state);
    for (const text of variants) {
      assert.throws(() => deserializeProject(text));
      assert.deepEqual(state, before);
    }
  });

  test("imported labels stay inert while unsafe colors reject", () => {
    const marker = '<b data-circuit-marker="012">MARK012</b>';
    const onerror = '<img src=x onerror="window.__CIRCUIT_012_MARKER__=1">';
    const marked = JSON.parse(f0Text);
    marked.title = marker;
    marked.probes[0].label = onerror;
    const restored = deserializeProject(JSON.stringify(marked));
    assert.equal(restored.title, marker);
    assert.equal(restored.probes[0].label, onerror);
    assert.doesNotMatch(escapeHtml(marker), /<b\b/);
    assert.doesNotMatch(escapeHtml(onerror), /<img\b/);
    const unsafe = structuredClone(marked); unsafe.probes[0].color = marker;
    assert.throws(() => deserializeProject(JSON.stringify(unsafe)));
  });

  test("geometry1/2 and legacy/ideal OP AMP round-trip with stable meaning", () => {
    const fixtures = [
      ["project-geometry1-divider.json", "R", 2.5],
      ["project-divider-f0.json", "R", 2.5],
      ["project-legacy-opamp.json", "OPAMP", 100000 / 100001],
      ["opamp-ideal-follower.json", "OPAMP_IDEAL", 1],
    ];
    for (const [file, type, expectedVoltage] of fixtures) {
      const project = deserializeProject(readFixture(file));
      const restored = deserializeProject(serializeProject(project));
      assert.equal(restored.circuit.geometryVersion, project.circuit.geometryVersion);
      assert.deepEqual(restored.circuit, project.circuit);
      const opamp = restored.circuit.components.find((component) => component.id === "U1");
      if (opamp) assert.equal(opamp.type, type);
      const result = simulateDC(restored.circuit);
      const target = opamp ? ["U1", 2] : ["R2", 0];
      close(node(result, result.points[0], ...target), expectedVoltage, 1e-12, 1e-8);
    }
  });
});
