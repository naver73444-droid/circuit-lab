import test from "node:test";
import assert from "node:assert/strict";

// Test the actual invalidation function without booting an unrelated fake browser.
import { refreshInvalidatedPortPanel } from "../src/port-ui-state.js";

function exercise(result) {
  const port = { result, stale: false, error: { code: "OLD", message: "old error" } };
  const dom = { status: "DC 포트 계산 중…", result: result ? "기존 결과" : "결과 없음" };
  const unrelated = { inspector: 0, drafts: 0, focus: 0 };
  let renders = 0;
  const renderPanel = () => {
    renders += 1;
    dom.status = port.stale ? "회로가 변경되어 이전 포트 결과가 오래되었습니다." : port.error ? "포트 분석 오류" : port.result ? "현재 회로 snapshot 결과" : "DC 선형 회로 전용";
    dom.result = port.result ? "기존 결과" : "결과 없음";
  };
  const changed = refreshInvalidatedPortPanel({ kind: "port" }, port, renderPanel);
  return { changed, port, dom, renders, unrelated };
}

test("CIRCUIT-018 port draft cancellation immediately renders the preserved result as stale", () => {
  const previous = { equivalent: { vth: { kind: "finite", value: 8 } } };
  const outcome = exercise(previous);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.port.result, previous);
  assert.equal(outcome.port.stale, true);
  assert.equal(outcome.port.error, null);
  assert.equal(outcome.dom.status, "회로가 변경되어 이전 포트 결과가 오래되었습니다.");
  assert.equal(outcome.dom.result, "기존 결과");
  assert.equal(outcome.renders, 1);
  assert.deepEqual(outcome.unrelated, { inspector: 0, drafts: 0, focus: 0 });
});

test("CIRCUIT-018 port draft cancellation without a previous result immediately leaves ready state", () => {
  const outcome = exercise(null);
  assert.equal(outcome.changed, true);
  assert.equal(outcome.port.result, null);
  assert.equal(outcome.port.stale, false);
  assert.equal(outcome.port.error, null);
  assert.equal(outcome.dom.status, "DC 선형 회로 전용");
  assert.equal(outcome.dom.result, "결과 없음");
  assert.equal(outcome.renders, 1);
  assert.deepEqual(outcome.unrelated, { inspector: 0, drafts: 0, focus: 0 });
});
