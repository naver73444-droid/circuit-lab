import test from "node:test";
import assert from "node:assert/strict";
import { beginPointerSession, finishPointerSession, ownsPointer, passedDragSlop, nearestScreenTarget, viewForPinch, distanceToSegment, CANVAS_VIEW_MIN_WIDTH, CANVAS_VIEW_MAX_WIDTH } from "../../src/interaction-math.js";

test("pointer transaction은 단일 owner·비소유 무시·취소/commit 멱등을 보장한다", () => {
  const first = beginPointerSession(null, 11, { kind: "component", id: "R1", origin: { x: 0, y: 0 } });
  assert.ok(ownsPointer(first, 11));
  assert.equal(beginPointerSession(first, 12, { kind: "pan" }), first);
  assert.equal(ownsPointer(first, 12), false);
  const ignored = finishPointerSession(first, 12, "cancel");
  assert.equal(ignored.session, first);
  assert.equal(ignored.finished, null);
  const cancelled = finishPointerSession(first, 11, "pointercancel");
  assert.equal(cancelled.session, null);
  assert.equal(cancelled.finished.reason, "pointercancel");
  assert.equal(finishPointerSession(cancelled.session, 11, "commit").finished, null);
});

test('touch slop uses 8 CSS pixels including the threshold', () => {
  assert.equal(passedDragSlop({x:10,y:20},{x:17.99,y:20},'touch'),false);
  assert.equal(passedDragSlop({x:10,y:20},{x:18,y:20},'touch'),true);
});

test('mouse slop uses 4 CSS pixels, not world coordinates', () => {
  assert.equal(passedDragSlop({x:10,y:20},{x:13.99,y:20},'mouse'),false);
  assert.equal(passedDragSlop({x:10,y:20},{x:14,y:20},'mouse'),true);
});

test('diagonal displacement uses Euclidean distance', () => {
  assert.equal(passedDragSlop({x:0,y:0},{x:6,y:6},'touch'),true);
});

test('invalid pointer coordinates cannot initiate an edit', () => {
  for (const point of [null,{x:NaN,y:0},{x:Infinity,y:1}]) assert.equal(passedDragSlop({x:0,y:0},point,'touch'),false);
});

test('a body-centre tap wins over an overlapping pin hit region', () => {
  const pin={kind:'pin',x:20,y:5,radius:30}, body={kind:'body',x:0,y:0,radius:28};
  assert.equal(nearestScreenTarget({x:0,y:0},[pin,body]),body);
});

test('a tap nearest a pin selects that pin independent of array order', () => {
  const a={kind:'body',x:0,y:0,radius:28}, b={kind:'pin',x:20,y:5,radius:22};
  for(const targets of [[a,b],[b,a]]) assert.equal(nearestScreenTarget({x:19,y:5},targets),b);
});

test('targets outside their own radius and invalid candidates are ignored', () => {
  assert.equal(nearestScreenTarget({x:0,y:0},[{x:100,y:0,radius:22},{x:NaN,y:0,radius:22}]),null);
  assert.equal(nearestScreenTarget(null,[]),null);
});

const start=()=>({view:{x:0,y:0,width:800,height:400},scale:.5,distance:100,
  midpoint:{x:200,y:100},center:{x:200,y:100},anchor:{x:400,y:200}});

test('pinch halves the viewport size when finger distance doubles', () => {
  assert.deepEqual(viewForPinch(start(),{x:200,y:100},200),{x:200,y:100,width:400,height:200});
});

test('pinch midpoint movement preserves the original world anchor', () => {
  const out=viewForPinch(start(),{x:220,y:130},200),scale=1;
  assert.equal(out.x+out.width/2+(220-200)/scale,400);
  assert.equal(out.y+out.height/2+(130-100)/scale,200);
});

test('pinch width is bounded while aspect ratio is preserved', () => {
  const small=viewForPinch(start(),{x:200,y:100},10000),large=viewForPinch(start(),{x:200,y:100},1);
  assert.equal(small.width,220);assert.equal(large.width,3040);
  // Binary floating point may round the aspect by one ULP; this is viewport geometry, not an electrical tolerance.
  assert.ok(Math.abs(small.height/small.width-.5)<1e-12);assert.ok(Math.abs(large.height/large.width-.5)<1e-12);
});

test('invalid pinch geometry is rejected instead of writing NaN viewBox', () => {
  assert.equal(viewForPinch(start(),{x:NaN,y:0},100),null);
  assert.equal(viewForPinch({...start(),scale:0},{x:0,y:0},100),null);
  assert.equal(viewForPinch(start(),{x:0,y:0},0),null);
  assert.equal(viewForPinch({...start(),view:{x:0,y:0,width:0,height:10}},{x:0,y:0},100),null);
  assert.equal(viewForPinch(null,{x:0,y:0},100),null);
});

test('screen-space hit tests cover a rotated body and clamp to segment ends', () => {
  assert.equal(distanceToSegment({x:5,y:25},{x:0,y:0},{x:0,y:50}),5);
  assert.equal(distanceToSegment({x:60,y:0},{x:0,y:0},{x:40,y:0}),20);
  assert.equal(distanceToSegment({x:3,y:4},{x:0,y:0},{x:0,y:0}),5);
  assert.equal(distanceToSegment({x:NaN,y:0},{x:0,y:0},{x:0,y:1}),Infinity);
});

test("canvas zoom and pinch share one limit pair", () => {
  assert.equal(CANVAS_VIEW_MIN_WIDTH, 220);
  assert.equal(CANVAS_VIEW_MAX_WIDTH, 3040);
  const start = { scale: 1, distance: 100, view: { x: 0, y: 0, width: 1000, height: 600 }, anchor: { x: 500, y: 300 }, center: { x: 100, y: 100 } };
  assert.equal(viewForPinch(start, { x: 100, y: 100 }, 1).width, CANVAS_VIEW_MAX_WIDTH);
  assert.equal(viewForPinch(start, { x: 100, y: 100 }, 1e6).width, CANVAS_VIEW_MIN_WIDTH);
});
