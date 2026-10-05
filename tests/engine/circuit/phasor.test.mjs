import test from "node:test";
import assert from "node:assert/strict";
import { simulateACAtFrequency } from "../../../src/circuit-engine.js";
import { cloneExample } from "../../../src/examples.js";
import { peakToRms, phasorFromPolar, phasorPolar, phasorTimeValue, wrapPhaseDifference } from "../../../src/phasor-format.js";
import { parsePracticeNumber, practiceOperations, relativePhase, polarToRectangular } from "../../../src/phasor-practice-model.js";

test("페이저 직교·극형, peak/RMS와 cos 시간 재구성이 일치한다", () => {
  const value = phasorFromPolar(3.5, 42);
  const polar = phasorPolar(value);
  assert.ok(Math.abs(polar.magnitude - 3.5) <= 1e-12);
  assert.ok(Math.abs(wrapPhaseDifference(polar.angleDegrees, 42)) <= 1e-12);
  assert.ok(Math.abs(peakToRms(polar.magnitude) - 3.5 / Math.sqrt(2)) <= 1e-12);
  const frequency = 123;
  const time = 0.00071;
  const expected = 3.5 * Math.cos(2 * Math.PI * frequency * time + 42 * Math.PI / 180);
  assert.ok(Math.abs(phasorTimeValue(value, frequency, time) - expected) <= 1e-12);
});

const near=(a,b,tol=1e-10)=>assert.ok(Math.abs(a-b)<tol,`${a} vs ${b}`);

test('practice numbers accept signed/scientific values but never turn empty or underflow into zero',()=>{
  assert.equal(parsePracticeNumber('-2.5'),-2.5);assert.equal(parsePracticeNumber('3e-3'),.003);
  for(const s of ['', '-', '1k', 'NaN','Infinity','1e200','1e-999'])assert.throws(()=>parsePracticeNumber(s));
});

test('3+j4 converts to magnitude 5 and correct atan2 quadrant',()=>{const p=phasorPolar({re:3,im:4});near(p.magnitude,5);near(p.angleDegrees,53.13010235415598);near(phasorPolar({re:-3,im:4}).angleDegrees,126.86989764584402);});

test('complex add/subtract/multiply/divide have independent analytic answers',()=>{
  const x=practiceOperations({re:3,im:4},{re:1,im:-2});assert.deepEqual(x['A+B'],{re:4,im:2});assert.deepEqual(x['A−B'],{re:2,im:6});assert.deepEqual(x['A×B'],{re:11,im:-2});near(x['A÷B'].re,-1);near(x['A÷B'].im,2);
});

test('zero phase and zero denominator remain undefined rather than 0 degrees',()=>{
  assert.equal(phasorPolar({re:0,im:0}).angleDegrees,null);assert.equal(relativePhase({re:0,im:0},{re:1,im:0}),null);const x=practiceOperations({re:1,im:0},{re:0,im:0});assert.equal(x['A÷B'],null);assert.match(x.divisionIssue,/B=0/);
});

test('sub-pico values are retained in polar/time calculations',()=>{const z={re:1e-15,im:0};assert.equal(phasorPolar(z).magnitude,1e-15);assert.equal(phasorTimeValue(z,100,0),1e-15);});

test('phase difference wraps 179 and -179 to -2 degrees',()=>{
  const z=d=>({re:Math.cos(d*Math.PI/180),im:Math.sin(d*Math.PI/180)});near(relativePhase(z(179),z(-179)),-2);near(relativePhase(z(90),z(0)),90);
});

test('peak/cos time waveform and RMS keep their original contract',()=>{const z={re:3,im:4};near(phasorTimeValue(z,50,0),3);near(phasorTimeValue(z,50,1/(4*50)),-4);near(peakToRms(5),5/Math.sqrt(2));});

test('unchanged real AC engine produces RC transfer expected from 1/(1+jωRC)',()=>{
  const example=cloneExample('rc-lowpass'), f=159.155;
  const result=simulateACAtFrequency(example.circuit,f);
  const r=example.circuit.components.find(x=>x.type==='R'),c=example.circuit.components.find(x=>x.type==='C');
  assert.ok(r&&c);assert.ok(result.points[0].componentCurrents[r.id]);
  const node=result.topology.nodeIdByPin[`${c.id}:0`],v=result.points[0].nodeVoltages[node],w=2*Math.PI*f*.001;
  near(v.re,1/(1+w*w),1e-9);near(v.im,-w/(1+w*w),1e-9);
});

test('polar degrees convert to rectangular and round-trip through atan2',()=>{const z=polarToRectangular(5,53.13010235415598);near(z.re,3);near(z.im,4);const q=polarToRectangular(2,450);near(q.re,0);near(q.im,2);});

test('polar rejects negative magnitude and nonfinite arguments but preserves zero convention',()=>{assert.throws(()=>polarToRectangular(-1,30));assert.throws(()=>polarToRectangular(1,Infinity));assert.equal(phasorPolar(polarToRectangular(0,90)).angleDegrees,null);});
