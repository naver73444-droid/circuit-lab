// "넷리스트 붙여넣기" in a real (headless) browser: paste the lab sheet's RC circuit, see each part read, open it laid out with its
// analysis and probes, run it; a bad line keeps the 불러오기 button off and names the line; on an iPad held sideways the button sits in
// the 파일 popover and the dialog fits the screen. Run with `node --test tests/browser/netlist-import.test.mjs`.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { L, ctx, ev, until, settle, navigate, click, problems, startServer, startBrowser, stopAll, assertNoProblems, resetProblems } from "./harness.mjs";

const RC = "* RC 1차 회로 (실험 1-1)\n* 신호 5Vpp 1kHz 구형파, C는 11nF와 47nF 각각\nV1 in 0 PULSE(-2.5 2.5 0 1u 1u 0.5m 1m)\nR1 in out 1.5k\nC1 out 0 11n\n.tran 5u 3m\n.probe V(in) V(out)";
const paste = (text) => ev(`(() => { const t = document.getElementById("netlist-text"); t.value = ${JSON.stringify(text)}; t.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const state = () => ev(`${L}.getState()`);
function dropLinuxManifestIcon() {
  if (process.platform !== "linux") return;
  for (let i = problems.length - 1; i >= 0; i -= 1) if (/Error while trying to use the following icon from the Manifest/.test(problems[i])) problems.splice(i, 1);
}

describe("netlist import", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { dropLinuxManifestIcon(); await assertNoProblems("console/network"); await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 }); });
  after(async () => { await stopAll(); });

  test("desktop: paste → preview of each part → 불러오기 opens the laid-out circuit with its transient settings and probes, and it runs", async () => {
    await navigate("/");
    await click("#netlist-button");
    assert.equal(await ev(`document.getElementById("netlist-dialog").open`), true);
    assert.equal(await ev(`document.getElementById("netlist-load").disabled`), true, "nothing to open yet");
    await paste(RC);
    assert.deepEqual(await ev(`[...document.querySelectorAll("#netlist-preview .netlist-parts li")].map((li) => li.textContent)`), [
      "V1  전압원  in – 접지  펄스 -2.5 V ↔ 2.5 V, 주기 1 ms (1 kHz), 폭 500 µs", "R1  저항  in – out  1.5 kΩ", "C1  커패시터  out – 접지  11 nF"]);
    await click("#netlist-load");
    assert.equal(await ev(`document.getElementById("netlist-dialog").open`), false, "the dialog closes");
    const s = await state();
    assert.equal(await ev(`document.getElementById("canvas-title").textContent`), "RC 1차 회로 (실험 1-1)");
    assert.equal(await ev(`document.getElementById("canvas-subtitle").textContent`), "신호 5Vpp 1kHz 구형파, C는 11nF와 47nF 각각");
    assert.deepEqual(s.circuit.components.map((c) => c.id).sort(), ["C1", "G1", "G2", "R1", "V1"]);
    assert.equal(s.settings.analysis, "transient");
    assert.deepEqual(s.probes.map((p) => p.label), ["V(V1.1)", "V(R1.2)"]);
    await click("#run-button");
    await until(`${L}.getState().runState.status === "success"`, "the transient run");
    // Undo brings the empty canvas back: opening a netlist is one history step like opening a file.
    await click("#undo-button");
    assert.equal((await state()).circuit.components.length, 0);
  });

  test("a line that cannot be read keeps 불러오기 off and says which line and why", async () => {
    await navigate("/");
    await click("#netlist-button");
    await paste("V1 in 0 DC 5\nR1 in out 1M\nQ1 c b e\nR2 out 0 1k");
    assert.equal(await ev(`document.getElementById("netlist-load").disabled`), true);
    assert.deepEqual(await ev(`[...document.querySelectorAll("#netlist-preview .netlist-error")].map((li) => li.textContent)`), [
      '2행: R1 값 "1M"을(를) 읽을 수 없습니다. 예: 1.5k, 11n, 10m (메가는 meg)', "3행: 트랜지스터(BJT)는 편집기에 없는 부품입니다 (Q1)."]);
    await paste("V1 in 0 DC 5\nR1 in out 1meg\nR2 out 0 1k");
    assert.equal(await ev(`document.getElementById("netlist-load").disabled`), false, "fixed: it can open");
    await click('#netlist-dialog button[value="cancel"]');
    assert.equal(await ev(`document.getElementById("netlist-dialog").open`), false);
    assert.equal((await state()).circuit.components.length, 0, "closing opens nothing");
  });

  test("iPad landscape: the button is in the 파일 popover, the dialog fits the screen with a 16 px text box", async () => {
    await ctx.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await navigate("/", { width: 1180, height: 740, mobile: true });
    await click("#file-menu > summary");
    await click("#netlist-button");
    assert.equal(await ev(`document.getElementById("file-menu").open`), false, "the popover closed behind the dialog");
    const box = await ev(`(() => { const r = document.getElementById("netlist-dialog").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, right: r.right }; })()`);
    assert.ok(box.top >= 0 && box.bottom <= 740 && box.right <= 1180, "inside the screen");
    assert.equal(await ev(`getComputedStyle(document.getElementById("netlist-text")).fontSize`), "16px", "no zoom when the text box is tapped");
    await paste(RC);
    await click("#netlist-load");
    await settle();
    assert.equal((await state()).circuit.components.length, 5);
  });
});
