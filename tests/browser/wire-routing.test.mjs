// Browser check of automatic wire routing (src/wire-router.js) with real mouse input in headless Edge (see harness.mjs).
// Run with `node --test tests/browser/wire-routing.test.mjs`. Set WIRE_ROUTING_SHOTS to a folder to also save screenshots there.
import { describe, test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  L, ctx, ev, settle, navigate, state, click, clickAt, dragPart, pinTip, sleep, dragBetween, runAnalysis, nodeValue,
  startServer, startBrowser, stopAll, leftoverProcessIds, isAlive, assertNoProblems, resetProblems,
} from "./harness.mjs";

const SHOTS = process.env.WIRE_ROUTING_SHOTS || "";
async function shot(name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const { data } = await ctx.cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
}

/** The points of a drawn wire path ("M40 0L160 0…"). */
const parsePath = (d) => [...String(d).matchAll(/[ML]\s*(-?[\d.e+-]+)[ ,]+(-?[\d.e+-]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
const drawnWires = () => ev(`Object.fromEntries([...document.querySelectorAll("#wire-layer [data-wire-id]")].map((group) => [group.dataset.wireId, group.querySelector(".wire").getAttribute("d")]))`);
function assertOrthogonal(points, what) {
  assert.ok(points.length >= 1, `${what}: no path`);
  for (let index = 0; index + 1 < points.length; index += 1) {
    const [p, q] = [points[index], points[index + 1]];
    assert.ok(Math.abs(p.x - q.x) < 1e-6 || Math.abs(p.y - q.y) < 1e-6, `${what}: diagonal segment (${p.x},${p.y})→(${q.x},${q.y})`);
  }
}
async function assertAllOrthogonal(what) {
  const wires = await drawnWires();
  for (const [id, d] of Object.entries(wires)) assertOrthogonal(parsePath(d), `${what} ${id}`);
  return wires;
}

async function autoUpdateOff() {
  if ((await state()).autoUpdate) await click("#auto-update");
}

/** New circuit with parts placed by palette clicks at screen offsets from the canvas centre; returns the part ids in order. */
async function placeParts(parts) {
  await navigate("/");
  await autoUpdateOff();
  const canvas = await ev(`(() => { const r = document.getElementById("circuit-canvas").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const [type, dx, dy, turns = 0] of parts) {
    await sleep(300);
    await click(`.palette-item[data-type="${type}"]`);
    await clickAt(canvas.x + dx, canvas.y + dy); await settle();
    await click('[data-tool="select"]');
    for (let turn = 0; turn < turns; turn += 1) await click("#rotate-button");
  }
  return (await state()).circuit.components.map((item) => item.id);
}

describe("automatic wire routing", { timeout: 300000 }, () => {
  before(async () => { await startServer(); await startBrowser(); });
  beforeEach(() => resetProblems());
  afterEach(async () => { await assertNoProblems("console/network"); });
  after(async () => {
    const started = [ctx.edge?.pid, ctx.server?.pid].filter(Boolean);
    const stopped = await stopAll();
    for (const pid of new Set([...started, ...stopped])) assert.equal(isAlive(pid), false, `process ${pid} should have been stopped`);
    assert.deepEqual(leftoverProcessIds(), [], "no process may still carry the throw-away Edge profile");
  });

  test("pin to pin without bend points: the live preview and the finished wire are horizontal/vertical only; moving a part keeps them so", async () => {
    const ids = await placeParts([["V", -300, 0, 1], ["R", -120, -90], ["R", 140, -10, 1], ["GND", -40, 100]]);
    assert.deepEqual(ids, ["V1", "R1", "R2", "G1"]);
    const pairs = [["V1", 0, "R1", 0], ["R1", 1, "R2", 0], ["R2", 1, "G1", 0], ["V1", 1, "G1", 0]];
    let preview = null;
    for (const [a, pinA, b, pinB] of pairs) {
      await dragBetween(await pinTip(a, pinA), await pinTip(b, pinB), {
        beforeRelease: async () => {
          if (preview) return;
          preview = await ev(`document.querySelector("#overlay-layer .wire-preview")?.getAttribute("d") ?? null`);
          await shot("after-0-preview");
        },
      });
    }
    assert.ok(preview, "a preview path was drawn while dragging");
    assertOrthogonal(parsePath(preview), "preview");
    const now = await state();
    assert.equal(now.circuit.wires.length, 4, "every drag made one wire");
    for (const wire of now.circuit.wires) assert.deepEqual(wire.anchors, [], `${wire.id} is fully automatic`);
    const before = await assertAllOrthogonal("drawn");
    assert.ok(Object.values(before).some((d) => parsePath(d).length > 2), "at least one wire needed corners (and got them)");
    await shot("after-1-drawn");

    await dragPart("R2", 120, 90);
    await dragPart("R1", -40, -60);
    const moved = await state();
    assert.notDeepEqual(moved.circuit.components.find((item) => item.id === "R2"), now.circuit.components.find((item) => item.id === "R2"), "R2 moved");
    await assertAllOrthogonal("after moving parts");
    assert.equal(moved.historyDepth, now.historyDepth + 2, "each move is one undo step (the wires go with it)");
    await shot("after-2-moved");
    await click("#undo-button"); await click("#undo-button");
    assert.deepEqual((await state()).circuit.wires, now.circuit.wires, "undo puts the wires back exactly");
  });

  test("click-click with a clicked bend point: the wire passes through it and every segment is horizontal/vertical", async () => {
    await placeParts([["R", -200, 0], ["R", 160, 80]]);
    await click('[data-tool="wire"]');
    const start = await pinTip("R1", 1);
    await clickAt(start.x, start.y); await settle();
    const canvas = await ev(`(() => { const r = document.getElementById("circuit-canvas").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    await clickAt(canvas.x - 40, canvas.y - 90); await settle();
    const end = await pinTip("R2", 0);
    await clickAt(end.x, end.y); await settle();
    const wire = (await state()).circuit.wires[0];
    assert.equal(wire.anchors.length, 1, "one clicked point");
    const points = parsePath((await drawnWires())[wire.id]);
    assertOrthogonal(points, "wire through the clicked point");
    const anchor = wire.anchors[0];
    const onPath = points.some((p, index) => index + 1 < points.length && (() => {
      const q = points[index + 1];
      return anchor.x >= Math.min(p.x, q.x) - 1e-6 && anchor.x <= Math.max(p.x, q.x) + 1e-6 && anchor.y >= Math.min(p.y, q.y) - 1e-6 && anchor.y <= Math.max(p.y, q.y) + 1e-6;
    })());
    assert.ok(onPath, "the clicked point lies on the wire");
  });

  test("배선 정리 on an example: one undo step, every wire orthogonal, the same analysis result; undo restores the saved drawing", async () => {
    await navigate("/?example=y-network");
    await autoUpdateOff();
    await click("#fit-button");
    await shot("before-3-y-network");
    await runAnalysis("dc");
    const reference = await state();
    await click("#tidy-wires-button");
    const tidy = await state();
    assert.equal(tidy.historyDepth, reference.historyDepth + 1, "one history entry");
    assert.ok(tidy.circuit.wires.every((wire) => Array.isArray(wire.anchors) && wire.anchors.length === 0), "every wire is now automatic");
    assert.deepEqual(tidy.circuit.wires.map((wire) => [wire.id, wire.a, wire.b]), reference.circuit.wires.map((wire) => [wire.id, wire.a, wire.b]), "the connections are untouched");
    await assertAllOrthogonal("tidied");
    await shot("after-3-y-network-tidied");
    const tidied = tidy.circuit.wires;
    await click("#undo-button");
    assert.deepEqual((await state()).circuit.wires, reference.circuit.wires, "undo restores the saved waypoints (and no anchors field)");
    await click("#redo-button");
    assert.deepEqual((await state()).circuit.wires, tidied, "redo tidies again");
    const depth = (await state()).historyDepth;
    await click("#tidy-wires-button");
    assert.equal((await state()).historyDepth, depth, "tidying a tidy drawing again adds no history");
    await runAnalysis("dc");
    const again = await state();
    for (const part of reference.circuit.components) {
      for (const index of [0, 1]) {
        if (part.type === "GND" && index) continue;
        assert.equal(nodeValue(again.result, 0, part.id, index), nodeValue(reference.result, 0, part.id, index), `${part.id}:${index} voltage`);
      }
    }
  });
});
