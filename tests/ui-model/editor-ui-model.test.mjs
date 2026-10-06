import test from "node:test";
import assert from "node:assert/strict";
import { parseValue, simulateTransient } from "../../src/circuit-engine.js";
import { acceptsRunGeneration, classifyNumericInput, cloneComponentSet } from "../../src/circuit-edit.js";

const cloneSelectedComponent = (circuit, componentId, offset = 40) => cloneComponentSet(circuit, [componentId], offset).components[0] ?? null;
import { cloneExample } from "../../src/examples.js";
import { classifyCircuitConnections } from "../../src/circuit-status.js";
import { nextAvailableProbeColor, passiveSliderModel, probeKeysForTarget, removeProbeByKey, sourceInlineDescriptor, controlledSourceInputModel, controlReferenceModel } from "../../src/ui-model.js";
import { suggestAnalysis } from "../../src/analysis-policy.js";

function nodeFor(result, componentId, pin) {
  return result.topology.nodeIdByPin[`${componentId}:${pin}`];
}

function voltage(result, pointIndex, componentId, pin = 0) {
  return result.points[pointIndex].nodeVoltages[nodeFor(result, componentId, pin)];
}

test("학습 입력 상태와 generation latest-wins 판정을 구분한다", () => {
  for (const value of ["", "-", "1e", "1e-"]) assert.equal(classifyNumericInput(value, { positive: true }).status, "editing");
  for (const value of ["banana", "0", "-2"]) assert.equal(classifyNumericInput(value, { positive: true }).status, "invalid");
  assert.deepEqual(classifyNumericInput("2.2u", { positive: true }), { status: "valid", value: 2.2e-6 });
  assert.equal(acceptsRunGeneration(8, 8), true);
  assert.equal(acceptsRunGeneration(8, 9), false);
});

function manualRcCircuit(sourceProps = {}) {
  return {
    version: 1,
    geometryVersion: 2,
    components: [
      { id: "source-x", type: "V", props: { ref: "VSRC", mode: "DC", dc: "10", amplitude: "2", frequency: "1k", offset: "0", phase: "0", pulseV1: "-1", pulseV2: "3", pulseDelay: "0", pulseRise: "0", pulseFall: "0", pulseWidth: "250u", pulsePeriod: "1m", acMagnitude: "1", acPhase: "0", ...sourceProps } },
      { id: "resistor-x", type: "R", props: { ref: "LOAD", value: "1k" } },
      { id: "capacitor-x", type: "C", props: { ref: "STORE", value: "1u", ic: "0" } },
      { id: "ground-x", type: "GND", props: { ref: "GND" } },
    ],
    wires: [
      { id: "input", a: { componentId: "source-x", pin: 0 }, b: { componentId: "resistor-x", pin: 0 } },
      { id: "output", a: { componentId: "resistor-x", pin: 1 }, b: { componentId: "capacitor-x", pin: 0 } },
      { id: "return-c", a: { componentId: "capacitor-x", pin: 1 }, b: { componentId: "ground-x", pin: 0 } },
      { id: "return-v", a: { componentId: "source-x", pin: 1 }, b: { componentId: "ground-x", pin: 0 } },
    ],
    junctions: [],
  };
}

test("연결 상태는 미배선·무접지·분석 floating·정상 RC를 구별한다", () => {
  const loose = { version: 1, components: [{ id: "loose", type: "R", props: { ref: "R9", value: "1k" } }], wires: [] };
  assert.equal(classifyCircuitConnections(loose).byComponent.loose.status, "unwired");

  const noGround = {
    version: 1,
    components: [
      { id: "v", type: "V", props: { ref: "Vx", mode: "DC", dc: "1" } },
      { id: "r", type: "R", props: { ref: "Rx", value: "1k" } },
    ],
    wires: [
      { id: "a", a: { componentId: "v", pin: 0 }, b: { componentId: "r", pin: 0 } },
      { id: "b", a: { componentId: "v", pin: 1 }, b: { componentId: "r", pin: 1 } },
    ],
  };
  assert.equal(classifyCircuitConnections(noGround).byComponent.r.status, "no-ground");

  const capacitorOnlyReference = {
    version: 1,
    components: [
      { id: "c", type: "C", props: { ref: "Cx", value: "1u", ic: "0" } },
      { id: "g", type: "GND", props: { ref: "GND" } },
    ],
    junctions: [{ id: "j", x: 0, y: 0 }],
    wires: [
      { id: "top", a: { componentId: "c", pin: 0 }, b: { junctionId: "j" } },
      { id: "bottom", a: { componentId: "c", pin: 1 }, b: { componentId: "g", pin: 0 } },
    ],
  };
  assert.equal(classifyCircuitConnections(capacitorOnlyReference, "dc").byComponent.c.status, "analysis-floating");
  assert.equal(classifyCircuitConnections(capacitorOnlyReference, "transient").byComponent.c.status, "referenced");
  assert.equal(classifyCircuitConnections(capacitorOnlyReference, "ac", { frequency: 1000 }).byComponent.c.status, "referenced");

  for (const analysis of ["dc", "transient", "ac"]) {
    const status = classifyCircuitConnections(manualRcCircuit(), analysis, { frequency: 159.154943 }).byComponent;
    assert.ok(Object.values(status).every((item) => item.status === "referenced"), `${analysis}: ${JSON.stringify(status)}`);
  }
});

test("source inline 의미는 분석·파형별 필드와 엔진 fallback을 따른다", () => {
  const voltage = { type: "V", props: { mode: "SIN", dc: "7", amplitude: "2", pulseV2: "3", acMagnitude: "4" } };
  assert.deepEqual(sourceInlineDescriptor(voltage, "dc"), { prop: "dc", label: "DC bias", unit: "V", value: "7" });
  assert.deepEqual(sourceInlineDescriptor(voltage, "transient"), { prop: "amplitude", label: "SIN peak", unit: "Vpk", value: "2" });
  voltage.props.mode = "PULSE";
  assert.equal(sourceInlineDescriptor(voltage, "transient").prop, "pulseV2");
  assert.deepEqual(sourceInlineDescriptor(voltage, "ac"), { prop: "acMagnitude", label: "AC peak", unit: "Vpk", value: "4" });
  assert.deepEqual(sourceInlineDescriptor({ type: "I", props: { mode: "SIN" } }, "transient"), { prop: "amplitude", label: "SIN peak", unit: "Apk", value: "0" });
  assert.equal(sourceInlineDescriptor({ type: "V", props: { mode: "PULSE" } }, "transient").value, "0");
  assert.equal(sourceInlineDescriptor({ type: "V", props: {} }, "ac").value, "0");
});

test("직접 만든 R/C/L slider는 예제 ID 없이 제공되고 범위 밖 값을 보존 표시한다", () => {
  for (const [type, value] of [["R", "1k"], ["C", "1u"], ["L", "10m"]]) {
    const slider = passiveSliderModel(type, value);
    assert.ok(slider);
    assert.equal(slider.outside, false);
    assert.ok(Number.isFinite(slider.value));
  }
  const outside = passiveSliderModel("R", "100G");
  assert.equal(outside.outside, true);
  assert.equal(outside.value, outside.max);
  assert.equal(parseValue("100G"), 100e9);
  assert.equal(passiveSliderModel("V", "5"), null);
});

test("우클릭 대상은 정확한 probe key 하나만 선택·삭제한다", () => {
  const probes = [
    { key: "V:R1:0", kind: "voltage", componentId: "R1", pin: 0, wireId: "W1" },
    { key: "V:J:J1", kind: "voltage", junctionId: "J1", wireId: "W1" },
    { key: "I:R1", kind: "current", componentId: "R1" },
  ];
  assert.deepEqual(probeKeysForTarget(probes, { kind: "pin", componentId: "R1", pin: 0 }), ["V:R1:0"]);
  assert.deepEqual(probeKeysForTarget(probes, { kind: "wire", wireId: "W1" }), ["V:R1:0", "V:J:J1"]);
  assert.deepEqual(probeKeysForTarget(probes, { kind: "component", componentId: "R1" }), ["I:R1"]);
  const remaining = removeProbeByKey(probes, "V:R1:0");
  assert.deepEqual(remaining.map((probe) => probe.key), ["V:J:J1", "I:R1"]);
  assert.equal(probes.length, 3);
  assert.equal(nextAvailableProbeColor(["green", "blue", "orange"], [{ color: "blue" }]), "green");
  assert.equal(nextAvailableProbeColor(["green", "blue"], [{ color: "green" }, { color: "blue" }]), "green");
});

function circuitFromBranches(branches) {
  const components = [...branches.map(([id, type, , , props]) => ({ id, type, props: { ref:id, ...props } })), {id:'G1',type:'GND',props:{ref:'GND'}}];
  const nets = new Map([['0', [{componentId:'G1',pin:0}]]]);
  for (const [id,,a,b] of branches) for (const [pin,net] of [[0,a],[1,b]]) {
    if (!nets.has(net)) nets.set(net,[]);
    nets.get(net).push({componentId:id,pin});
  }
  const wires=[];
  for (const ends of nets.values()) for (const end of ends.slice(1)) wires.push({id:`W${wires.length+1}`,a:ends[0],b:end});
  return {version:1,components,wires};
}

const transient = (circuit) => simulateTransient(circuit,{start:0,end:'10u',step:'10u'});

const parallel = () => circuitFromBranches([
  ['C1','C','a','0',{value:'1u',ic:'5'}], ['C2','C','a','0',{value:'3u',ic:'5'}], ['R1','R','a','0',{value:'1k'}],
]);

test('auto analysis chooses sensible intent without altering circuit or initial conditions',()=>{
  const c=cloneExample('rc-charge').circuit,before=structuredClone(c);const p=suggestAnalysis(c,{analysis:'dc'},'auto');assert.equal(p.settings.analysis,'transient');assert.ok(Number(p.settings.end)<.1);assert.deepEqual(c,before);
  assert.equal(suggestAnalysis(cloneExample('divider').circuit,{analysis:'ac'},'auto').settings.analysis,'dc');
});

test('expert settings stay exact and automatic AC never rewrites SIN or IC',()=>{
  const c=cloneExample('parallel-sine').circuit, before=structuredClone(c);const previous={analysis:'transient',start:'1m',end:'3m',step:'3u'};
  assert.deepEqual(suggestAnalysis(c,previous,'manual').settings,previous);assert.equal(suggestAnalysis(c,previous,'ac').settings.analysis,'ac');assert.deepEqual(c,before);
});

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

test("inline units, draft classification and clone props are type-specific", () => {
  assert.deepEqual(sourceInlineDescriptor(project.circuit.components[0], "dc"), { prop: "g", label: "전압 이득", unit: "V/V", value: "4" });
  assert.deepEqual(sourceInlineDescriptor(project.circuit.components[1], "ac"), { prop: "gm", label: "상호컨덕턴스", unit: "S", value: "3mS" });
  assert.equal(controlledSourceInputModel("VCVS", "-2").status, "valid");
  assert.equal(controlledSourceInputModel("VCVS", "1V").status, "invalid");
  assert.equal(controlledSourceInputModel("VCCS", "20µS").status, "valid");
  assert.equal(controlledSourceInputModel("VCCS", "20s").status, "invalid");
  const clone = cloneSelectedComponent(project.circuit, "E1");
  assert.equal(clone.type, "VCVS"); assert.deepEqual(clone.props, { ref: "E2", g: "4" }); assert.notEqual(clone.id, "E1");
});

test("connection status never joins control pins to output pins", () => {
  const result = classifyCircuitConnections(project.circuit, "dc");
  assert.deepEqual(result.byComponent.E1.floatingPins.sort(), [3]);
  assert.deepEqual(result.byComponent.G1.floatingPins.sort(), [1, 3]);
});

test("coefficient inputs and inline descriptors are dimension-specific", () => {
  assert.equal(controlledSourceInputModel("CCCS", "-2").status, "valid");
  assert.equal(controlledSourceInputModel("CCCS", "1A").status, "invalid");
  assert.equal(controlledSourceInputModel("CCVS", "2kΩ").status, "valid");
  assert.equal(controlledSourceInputModel("CCVS", "2S").status, "invalid");
  assert.deepEqual(sourceInlineDescriptor({ type: "CCCS", props: { beta: "3" } }, "dc"), { prop: "beta", label: "전류 이득", unit: "A/A", value: "3" });
  assert.deepEqual(sourceInlineDescriptor({ type: "CCVS", props: { rm: "2k" } }, "ac"), { prop: "rm", label: "전달저항", unit: "Ω", value: "2k" });
});

test("reference model lists only V/sensor and preserves missing IDs", () => {
  const circuit = { components: [
    { id: "V1", type: "V", props: { ref: "renamed" } }, { id: "S1", type: "CURRENT_SENSOR", props: { ref: "sense" } },
    { id: "R1", type: "R", props: { ref: "R1" } },
  ] };
  const valid = controlReferenceModel(circuit, { type: "CCCS", control: { kind: "branchCurrent", elementId: "S1", direction: 1 } });
  assert.equal(valid.status, "valid"); assert.deepEqual(valid.targets.map((item) => item.id), ["V1", "S1"]);
  const missing = controlReferenceModel(circuit, { type: "CCVS", control: { kind: "branchCurrent", elementId: "gone", direction: -1 } });
  assert.equal(missing.status, "missing"); assert.match(missing.reason, /gone/);
});
