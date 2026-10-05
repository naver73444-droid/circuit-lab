import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { C, MU0, EPS0, K, pointChargesField, dipoleField, lineCurrentField, loopCurrentField, loopFieldAtN, loopWireDistance, planeWaveField, norm3, dot3, cross3, sub3 } from '../src/em-physics.js';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/CIRCUIT-023/contracts.json',import.meta.url)));
const close=(a,b,abs=1e-12,rel=1e-9)=>assert.ok(Math.abs(a-b)<=abs+rel*Math.abs(b),`${a} != ${b}`);
const vector=(a,b,abs=1e-12,rel=1e-9)=>a.forEach((x,i)=>close(x,b[i],abs,rel));

test('CIRCUIT-023 constants and electrostatics match independent fixture',()=>{
  assert.equal(C,fixture.constants.c);close(MU0,fixture.constants.mu0,0,0);close(EPS0,fixture.constants.epsilon0,1e-27,1e-15);close(K,fixture.constants.kCoulomb,1e-6,1e-15);
  const source={q:fixture.pointCharge.chargeC,position:[0,0,0]};
  const one=pointChargesField([source],fixture.pointCharge.at1m.point),two=pointChargesField([source],fixture.pointCharge.at2m.point);
  vector(one.E,fixture.pointCharge.at1m.electricField,1e-9);close(one.potential,fixture.pointCharge.at1m.potential,1e-9);
  vector(two.E,fixture.pointCharge.at2m.electricField,1e-9);close(two.potential,fixture.pointCharge.at2m.potential,1e-9);
  const negative=pointChargesField([{...source,q:-source.q}],[1,0,0]);vector(negative.E,one.E.map(x=>-x),1e-9);close(negative.potential,-one.potential,1e-9);
  const dipole=dipoleField({q:1e-9,separation:1,axis:[1,0,0],center:[0,0,0]},[0,0,0]);vector(dipole.E,fixture.dipole.electricField,1e-9);close(dipole.potential,0,1e-9);
  assert.equal(pointChargesField([{q:1e-9,position:[0,0,0]}],[.001,0,0]).status,'excluded');
  assert.deepEqual(pointChargesField([{q:0,position:[0,0,0]}],[0,0,0]),{status:'valid',E:[0,0,0],potential:0});
  assert.throws(()=>pointChargesField([{q:NaN,position:[0,0,0]}],[1,0,0]),/유한한 숫자/);
  assert.throws(()=>pointChargesField([{q:2e-6,position:[0,0,0]}],[1,0,0]),/범위/);
});

test('CIRCUIT-023 infinite line and loop direction, exclusion and convergence',()=>{
  const line={current:1,position:[0,0,0],direction:[0,0,1]};
  const b1=lineCurrentField(line,[1,0,0]),b2=lineCurrentField(line,[2,0,0]);vector(b1.B,fixture.straightCurrent.at1m.magneticField,1e-15);vector(b2.B,fixture.straightCurrent.at2m.magneticField,1e-15);
  vector(lineCurrentField({...line,current:-1},[1,0,0]).B,b1.B.map(x=>-x),1e-15);vector(lineCurrentField(line,[-1,0,0]).B,b1.B.map(x=>-x),1e-15);assert.equal(lineCurrentField(line,[0,0,.5]).status,'excluded');
  const loop={current:1,radius:1,center:[0,0,0],normal:[0,0,1]};
  const center=loopCurrentField(loop,[0,0,0]),axis=loopCurrentField(loop,[0,0,1]);vector(center.B,fixture.loop.center.magneticField,1e-12,1e-4);vector(axis.B,fixture.loop.axis1m.magneticField,1e-12,1e-4);
  vector(loopCurrentField({...loop,current:-1},[0,0,0]).B,center.B.map(x=>-x),1e-12,1e-4);
  const p=[.5,0,.5],n64=loopFieldAtN(loop,p,64),n128=loopFieldAtN(loop,p,128),n256=loopFieldAtN(loop,p,256),mirror=loopFieldAtN(loop,[-.5,0,.5],256);
  close(n256[1],0,1e-12,0);close(mirror[0],-n256[0],1e-12,1e-4);close(mirror[2],n256[2],1e-12,1e-4);
  assert.ok(norm3(sub3(n256,n128))<=1e-12+1e-3*norm3(n256));assert.ok(norm3(sub3(n256,n128))<=norm3(sub3(n128,n64))+1e-12);
  close(loopWireDistance(loop,[1,0,0]),0,1e-15,0);assert.equal(loopCurrentField(loop,[1,0,0]).status,'excluded');
  assert.deepEqual(loopCurrentField({...loop,current:0},[1,0,0]).B,[0,0,0]);
});

test('CIRCUIT-023 plane wave phase, orthogonality and propagation convention',()=>{
  const model={amplitude:3,frequency:1e6,phase:0,direction:[0,0,1],polarization:[1,0,0]},T=1e-6,lambda=C/1e6;
  const start=planeWaveField(model,[0,0,0],0);vector(start.E,fixture.planeWave.originT0.electricField,1e-9);vector(start.B,fixture.planeWave.originT0.magneticField,1e-15);
  const quarter=planeWaveField(model,[0,0,0],T/4),half=planeWaveField(model,[0,0,0],T/2),travel=planeWaveField(model,[0,0,lambda/4],T/4);
  vector(quarter.E,[0,0,0],1e-9,0);vector(quarter.B,[0,0,0],1e-15,0);vector(half.E,[-3,0,0],1e-9);vector(half.B,[0,-3/C,0],1e-15);vector(travel.E,[3,0,0],1e-9);close(start.wavelength,fixture.planeWave.wavelengthM,1e-12);
  close(dot3(start.E,start.B),0,1e-15,0);close(dot3(start.E,model.direction),0,1e-15,0);close(norm3(start.E)/norm3(start.B),C,1e-6);assert.ok(cross3(start.E,start.B)[2]>0);
  const reverse=planeWaveField({...model,direction:[0,0,-1]},[0,0,0],0);assert.ok(reverse.B[1]<0);assert.ok(cross3(reverse.E,reverse.B)[2]<0);
  assert.deepEqual(planeWaveField({...model,amplitude:0},[0,0,0],0).E,[0,0,0]);
});
