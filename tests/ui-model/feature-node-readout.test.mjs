import test from "node:test";
import assert from "node:assert/strict";
import { componentReadout, hoverReadout, nodeIdForTarget, nodeReadout, pinsOnNode, resolveSample, topologyFor } from "../../src/node-readout-model.js";
import { buildTopology, pinCount, simulate, simulateACAtFrequency } from "../../src/circuit-engine.js";
import { cloneExample, examples } from "../../src/examples.js";

const near = (actual, expected, tolerance, message = "") => assert.ok(Math.abs(actual - expected) <= tolerance, `${message} ${actual} vs ${expected} (±${tolerance})`);

function run(id) {
  const example = cloneExample(id);
  return { circuit: example.circuit, result: simulate(example.circuit, example.settings), settings: example.settings };
}

test("분압기 DC: 중간 노드 5 V, 상단 10 V, GND 0 V", () => {
  const { circuit, result } = run("divider");
  const middle = nodeReadout({ circuit, result, target: { kind: "pin", componentId: "R1", pin: 1 } });
  assert.equal(middle.ok, true);
  assert.equal(middle.voltage.value, 5);
  assert.equal(middle.voltage.text, "5 V");
  assert.equal(middle.mode, "dc");
  assert.deepEqual(middle.pins, ["R1.2", "R2.1"]);
  assert.match(middle.text, /노드 N2/);
  assert.match(middle.text, /직류 동작점/);
  assert.equal(nodeReadout({ circuit, result, target: { kind: "pin", componentId: "R1", pin: 0 } }).voltage.value, 10);
  const ground = nodeReadout({ circuit, result, target: { kind: "pin", componentId: "G1", pin: 0 } });
  assert.equal(ground.voltage.value, 0);
  assert.match(ground.title, /GND/);
  // 배선 W2 (R1.2 – R2.1) 도 같은 노드
  assert.equal(nodeReadout({ circuit, result, target: { kind: "wire", wireId: "W2" } }).voltage.value, 5);
  assert.equal(hoverReadout({ circuit, result, target: { kind: "node", nodeId: 2 } }).voltage.value, 5);
});

test("분압기 DC: 부품 판독 — R1 5 mA, 5 V, 25 mW / 전원은 50 mW 공급", () => {
  const { circuit, result } = run("divider");
  const r1 = componentReadout({ circuit, result, componentId: "R1" });
  assert.equal(r1.ok, true);
  near(r1.current.value, 0.005, 1e-12);
  assert.equal(r1.current.text, "5 mA");
  assert.equal(r1.current.direction, "pin 1→2");
  assert.equal(r1.voltage.value, 5);
  assert.equal(r1.voltage.text, "5 V");
  near(r1.power.value, 0.025, 1e-12);
  assert.equal(r1.power.text, "25 mW");
  assert.equal(r1.power.kind, "dissipated");
  assert.match(r1.text, /R1 \(저항\)/);
  assert.match(r1.text, /전류 5 mA/);
  assert.match(r1.text, /소비 전력 25 mW/);
  assert.equal(r1.pins.length, 2);
  const v1 = componentReadout({ circuit, result, componentId: "V1" });
  assert.equal(v1.voltage.value, 10);
  assert.equal(v1.power.kind, "supplied");
  near(v1.power.value, -0.05, 1e-12);
  assert.equal(v1.power.text, "50 mW");
  const ground = componentReadout({ circuit, result, componentId: "G1" });
  assert.equal(ground.current, null);
  assert.equal(ground.voltage.value, 0);
  assert.equal(hoverReadout({ circuit, result, target: { kind: "component", componentId: "R2" } }).power.text, "25 mW");
});

test("과도 응답: 시간 인덱스/시간 값으로 판독 (RC, t=τ에서 약 3.16 V)", () => {
  const { circuit, result } = run("rc-charge");
  const index = result.xValues.findIndex((t) => Math.abs(t - 1e-3) < 1e-9);
  assert.ok(index > 0);
  const byIndex = nodeReadout({ circuit, result, target: { kind: "pin", componentId: "C1", pin: 0 }, index });
  near(byIndex.voltage.value, 5 * (1 - Math.exp(-1)), 0.05);
  assert.equal(byIndex.mode, "transient");
  assert.equal(byIndex.sample.index, index);
  assert.match(byIndex.sample.xText, /^t = 1 ms$/);
  const byTime = nodeReadout({ circuit, result, target: { kind: "pin", componentId: "C1", pin: 0 }, x: 1.0004e-3 });
  assert.equal(byTime.sample.index, index);
  assert.equal(byTime.voltage.value, byIndex.voltage.value);
  assert.equal(nodeReadout({ circuit, result, target: { kind: "pin", componentId: "C1", pin: 0 }, index: 99999 }).ok, false);
  const capacitor = componentReadout({ circuit, result, componentId: "C1", index });
  assert.ok(capacitor.current.value > 0 && capacitor.power);
  const t0 = nodeReadout({ circuit, result, target: { kind: "pin", componentId: "C1", pin: 0 } });
  assert.equal(t0.sample.index, 0);
});

test("AC 스윕: 선택 주파수에서 크기∠위상, 차단주파수 근처 0.707 V ∠ -45°", () => {
  const { circuit, result } = run("rc-lowpass");
  const fc = 1 / (2 * Math.PI * 1e3 * 1e-6);
  const readout = nodeReadout({ circuit, result, target: { kind: "pin", componentId: "C1", pin: 0 }, x: fc });
  assert.equal(readout.ok, true);
  assert.equal(readout.mode, "ac");
  near(readout.voltage.value, Math.SQRT1_2, 0.01);
  near(readout.voltage.phasor.phaseDeg, -45, 1);
  assert.match(readout.voltage.text, /V ∠ -4\d(\.\d+)?°/);
  near(readout.voltage.phasor.level, -3.01, 0.1);
  assert.match(readout.sample.xText, /^f = 1\d\d(\.\d+)? Hz$/);
  const resistor = componentReadout({ circuit, result, componentId: "R1", x: fc });
  assert.ok(resistor.current.phasor);
  assert.equal(resistor.power.kind, "dissipated");
  // 평균 전력 = ½|I|²R
  near(resistor.power.value, 0.5 * resistor.current.value ** 2 * 1000, 1e-9);
});

test("단일 페이저 결과(ac-point)와 DC는 인덱스를 무시", () => {
  const example = cloneExample("rc-lowpass");
  const result = simulateACAtFrequency(example.circuit, "1k");
  const readout = nodeReadout({ circuit: example.circuit, result, target: { kind: "pin", componentId: "C1", pin: 0 }, index: 5 });
  assert.equal(readout.ok, true);
  assert.equal(readout.sample.index, 0);
  assert.match(readout.sample.xText, /1 kHz/);
});

test("핀→노드 매핑이 엔진과 동일 (result.topology 유무와 무관, 모든 예제의 모든 핀)", () => {
  for (const example of examples) {
    const circuit = structuredClone(example.circuit);
    const result = simulate(circuit, example.settings);
    const engine = buildTopology(circuit);
    const withoutTopology = { ...result, topology: undefined };
    assert.equal(topologyFor(circuit, withoutTopology).source, "circuit");
    for (const component of circuit.components) {
      for (let pin = 0; pin < pinCount(component.type); pin += 1) {
        const expected = engine.nodeFor(component.id, pin);
        const target = { kind: "pin", componentId: component.id, pin };
        assert.equal(nodeIdForTarget(circuit, result, target), expected, `${example.id} ${component.id}.${pin}`);
        assert.equal(nodeIdForTarget(circuit, withoutTopology, target), expected);
      }
    }
  }
});

test("접속점(junction)과 배선 끝점이 접속점인 경우도 같은 노드", () => {
  const example = cloneExample("divider");
  const circuit = example.circuit;
  circuit.junctions = [{ id: "J1", x: 360, y: 220 }];
  circuit.wires = circuit.wires.filter((wire) => wire.id !== "W2");
  circuit.wires.push(
    { id: "W5", a: { componentId: "R1", pin: 1 }, b: { junctionId: "J1" } },
    { id: "W6", a: { junctionId: "J1" }, b: { componentId: "R2", pin: 0 } },
  );
  const result = simulate(circuit, example.settings);
  assert.equal(nodeReadout({ circuit, result, target: { kind: "junction", junctionId: "J1" } }).voltage.value, 5);
  assert.equal(nodeReadout({ circuit, result, target: { kind: "wire", wireId: "W6" } }).voltage.value, 5);
  assert.equal(nodeReadout({ circuit, result, target: { kind: "junction", junctionId: "nope" } }).ok, false);
});

test("전력 부호 일관성(Tellegen): 2단자 부품 전력의 합 ≈ 0 (모든 예제, 여러 시점)", () => {
  for (const example of examples.filter((item) => item.id !== "opamp")) {
    const circuit = structuredClone(example.circuit);
    const result = simulate(circuit, example.settings);
    if (result.analysis === "ac") continue;
    const stride = Math.max(1, Math.floor(result.points.length / 7));
    for (let index = 0; index < result.points.length; index += stride) {
      let total = 0;
      let scale = 0;
      for (const component of circuit.components) {
        if (pinCount(component.type) !== 2) continue;
        const readout = componentReadout({ circuit, result, componentId: component.id, index });
        assert.equal(readout.ok, true);
        if (!readout.power) continue;
        const signed = readout.power.signed ?? readout.power.value;
        total += signed;
        scale += Math.abs(signed);
      }
      assert.ok(Math.abs(total) <= 1e-6 * Math.max(scale, 1e-9), `${example.id}[${index}] 전력 합 ${total} / ${scale}`);
    }
  }
});

test("OP AMP 부품은 출력 전압을 표시하고 전력은 계산하지 않는다", () => {
  const { circuit, result } = run("opamp");
  const op = componentReadout({ circuit, result, componentId: "U1" });
  assert.equal(op.ok, true);
  assert.equal(op.pins.length, 3);
  near(op.voltage.value, 0.9999, 1e-3);
  assert.equal(op.power, null);
  assert.ok(op.current);
});

test("잘못된 입력은 ok:false + 이유", () => {
  const { circuit, result } = run("divider");
  assert.equal(nodeReadout({ circuit, result: null, target: { kind: "node", nodeId: 1 } }).ok, false);
  assert.equal(nodeReadout({ circuit, result, target: { kind: "pin", componentId: "X9", pin: 0 } }).ok, false);
  assert.equal(nodeReadout({ circuit, result, target: { kind: "node", nodeId: 77 } }).ok, false);
  assert.equal(nodeReadout({ circuit, result }).ok, false);
  assert.match(componentReadout({ circuit, result, componentId: "nope" }).reason, /찾을 수 없습니다/);
  assert.equal(resolveSample({ analysis: "dc", points: [], xValues: [] }), null);
  assert.deepEqual(pinsOnNode(circuit, result, 2), ["R1.2", "R2.1"]);
});

test("전류원: 공급 전력 부호가 저항 소비와 일치", () => {
  const part = (id, type, props) => ({ id, type, x: 0, y: 0, rotation: 0, props: { ref: id, ...props } });
  const circuit = {
    version: 1,
    components: [part("I1", "I", { mode: "DC", dc: "1m" }), part("R1", "R", { value: "1k" }), part("G1", "GND", {})],
    wires: [
      { id: "W1", a: { componentId: "I1", pin: 0 }, b: { componentId: "G1", pin: 0 } },
      { id: "W2", a: { componentId: "I1", pin: 1 }, b: { componentId: "R1", pin: 0 } },
      { id: "W3", a: { componentId: "R1", pin: 1 }, b: { componentId: "G1", pin: 0 } },
    ],
  };
  const result = simulate(circuit, { analysis: "dc" });
  const source = componentReadout({ circuit, result, componentId: "I1" });
  const resistor = componentReadout({ circuit, result, componentId: "R1" });
  assert.equal(source.power.kind, "supplied");
  near(source.power.value + resistor.power.value, 0, 1e-12);
  assert.equal(nodeReadout({ circuit, result, target: { kind: "pin", componentId: "R1", pin: 0 } }).voltage.text, "1 V");
});
