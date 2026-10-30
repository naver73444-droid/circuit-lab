import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { zoomAxis, fittedAxis, step125, engineering, fittedXAxis, nearestSampleIndex, extremaIndices, pulseWindowHint } from "../../src/scope-model.js";

test("large finite plotting data cannot cause an endless autoscale loop", () => {
  const url = new URL("../../src/scope-model.js", import.meta.url).href;
  const execution = spawnSync(process.execPath, ["--input-type=module", "-e", `import { fittedAxis } from ${JSON.stringify(url)}; console.log(JSON.stringify(fittedAxis([-3.15e20,4.05e20])));`], { encoding: "utf8", timeout: 1200 });
  assert.equal(execution.error?.code, undefined, "autoscale process exceeded 1200 ms");
  assert.equal(execution.status, 0, execution.stderr);
  const axis = JSON.parse(execution.stdout); assert.ok(axis.minimum <= -3.15e20 && axis.maximum >= 4.05e20);
});

test("zoom clamps its anchor consistently outside the plotting rectangle", () => {
  const axis = { minimum: 0, maximum: 8, division: 1, automatic: true };
  assert.deepEqual(zoomAxis(axis, 1, -2), zoomAxis(axis, 1, 0));
  assert.deepEqual(zoomAxis(axis, 1, 3), zoomAxis(axis, 1, 1));
});

test("unsupported display extremes reject explicitly", () => {
  assert.throws(() => fittedAxis([1e301]), RangeError);
  assert.throws(() => fittedAxis([1e-301]), RangeError);
  assert.ok(Number.isFinite(fittedAxis([0, 1e-25]).division));
});

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('1-2-5 divisions traverse both directions',()=>{
  close(step125(.001,1),.002);close(step125(.002,1),.005);close(step125(.005,1),.01);close(step125(.001,-1),.0005);close(step125(.0005,-1),.0002);
});

test('automatic axes contain values, use eight divisions and handle zero',()=>{
  for(const values of [[0,5],[-2,8],[0,0],[1e-6,3e-6],[-100,-1],[]]){
    const a=fittedAxis(values);close((a.maximum-a.minimum)/a.division,8,1e-8);
    for(const value of values)assert.ok(value>=a.minimum-1e-15&&value<=a.maximum+1e-15);
  }
});

test('logarithmic X fit and zoom keep their anchor',()=>{
  const a=fittedXAxis([10,100,1000],true);close(a.minimum,1);close((a.maximum-a.minimum)/a.division,10);
  const b=zoomAxis(a,-1,.3,10);close(a.minimum+.3*(a.maximum-a.minimum),b.minimum+.3*(b.maximum-b.minimum));assert.equal(b.automatic,false);
});

test('cursor selects actual nearest sample for nonuniform time and AC endpoints',()=>{
  assert.equal(nearestSampleIndex([0,.001,.002,.0025],.00249),3);assert.equal(nearestSampleIndex([10,100,1000],101),1);assert.equal(nearestSampleIndex([0,1],0),0);assert.equal(nearestSampleIndex([],1),null);
});

test('display reduction retains narrow extrema and gaps without mutating samples',()=>{
  const x=Array.from({length:10000},(_,i)=>i), y=x.map(()=>0);y[101]=17;y[102]=-20;y[6000]=NaN;
  const i=extremaIndices(x,y,0,9999,100);assert.ok(i.includes(101)&&i.includes(102)&&i.includes(6000));assert.ok(i.length<1000);assert.equal(y.length,10000);
});

test('engineering text handles zero, femto and large powers without truncation',()=>{
  assert.equal(engineering(0,'s'),'0 s');assert.equal(engineering(.005,'A'),'5 mA');assert.equal(engineering(1e-15,'F'),'1 fF');assert.equal(engineering(1e10,'Hz'),'10 GHz');assert.equal(engineering(-45,'°'),'-45 °');
});

test("pulseWindowHint: a pulse still on at the window's end reads as a step and says so; one that turns off inside the window does not", () => {
  const source = (props) => ({ components: [{ id: "c1", type: "V", props: { mode: "PULSE", ref: "V1", ...props } }] });
  const hint = pulseWindowHint(source({ pulseWidth: "1", pulsePeriod: "2" }), { end: "5m" });
  assert.match(hint, /^V1 펄스가 1s까지 켜져 있어 이 창\(5ms\)/);
  assert.match(hint, /속성에서 펄스 폭·주기를/, "a 2 s period is out of reach of 시간 +");
  assert.equal(pulseWindowHint(source({}), { end: "5m" }) !== null, true, "the editor default (width 1 s) counts");
  assert.equal(pulseWindowHint(source({ pulseWidth: "2m", pulsePeriod: "4m" }), { end: "5m" }), null);
  assert.match(pulseWindowHint(source({ pulseWidth: "2m", pulsePeriod: "4m" }), { end: "1m" }), /시간 눈금 \+ 로 창을 늘리면/, "the example's first view: widen the window");
  assert.equal(pulseWindowHint(source({ pulseDelay: "10m" }), { end: "5m" }), null, "not on yet: no step to explain");
  assert.equal(pulseWindowHint(source({ mode: "DC" }), { end: "5m" }), null);
  assert.equal(pulseWindowHint(source({ pulseWidth: "abc" }), { end: "5m" }), null, "unreadable values are left to the analysis error");
});
