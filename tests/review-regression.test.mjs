import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateTransient, simulateAC, simulateDC, validateCircuitStructure } from '../src/circuit-engine.js';
import { cloneExample } from '../src/examples.js';
import { deleteComponentFromCircuit } from '../src/circuit-edit.js';
import { serializeProject, deserializeProject } from '../src/project-format.js';
import { UnionFind } from '../src/union-find.js';
import { isSafeColor, escapeHtml } from '../src/safe-dom.js';
import { suggestAnalysis } from '../src/analysis-policy.js';
import { step125, engineering, fittedAxis, fittedXAxis, zoomAxis, nearestSampleIndex, extremaIndices } from '../src/scope-model.js';
import { buildResultsCSV, parseCSV } from '../src/csv-format.js';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
/** Build test topology from named electrical nets, independently of app geometry. */
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
const voltage = (result,id,pin=0) => result.points[0].nodeVoltages[result.topology.nodeIdByPin[`${id}:${pin}`]];
const parallel = () => circuitFromBranches([
  ['C1','C','a','0',{value:'1u',ic:'5'}], ['C2','C','a','0',{value:'3u',ic:'5'}], ['R1','R','a','0',{value:'1k'}],
]);

test('REVIEW: parallel capacitors preserve 5 V and divide initial current by capacitance',()=>{
  const r=transient(parallel()); close(voltage(r,'C1'),5); close(voltage(r,'C2'),5);
  close(r.points[0].componentCurrents.C1,-.00125); close(r.points[0].componentCurrents.C2,-.00375);
  close(Object.values(r.points[0].componentCurrents).reduce((a,b)=>a+b,0),0);
});
test('REVIEW: compatible capacitor results are independent of component ordering',()=>{
  const c=parallel(); const first=transient(c); c.components.reverse();const second=transient(c);
  for(const id of ['C1','C2','R1']){close(voltage(first,id),voltage(second,id));close(first.points[0].componentCurrents[id],second.points[0].componentCurrents[id]);}
});
test('REVIEW: contradictory capacitor initial voltages are still errors',()=>{
  const c=parallel(); c.components[1].props.ic='4'; assert.throws(()=>transient(c),e=>e.code==='INITIAL_CONDITION_CONFLICT');
});
test('REVIEW: capacitor triangle preserves all voltage constraints and both KCL equations',()=>{
  const c=circuitFromBranches([
    ['C1','C','a','0',{value:'1u',ic:'3'}],['C2','C','b','0',{value:'2u',ic:'1'}],['C3','C','a','b',{value:'3u',ic:'2'}],
    ['R1','R','a','0',{value:'1k'}],['R2','R','b','0',{value:'2k'}],
  ]);
  const r=transient(c), i=r.points[0].componentCurrents;
  close(voltage(r,'C1'),3);close(voltage(r,'C2'),1);close(voltage(r,'C3')-voltage(r,'C3',1),2);
  close(i.C1,-.0015);close(i.C2,-.002);close(i.C3,-.0015);close(i.C1+i.C3+i.R1,0);close(i.C2-i.C3+i.R2,0);
});
test('REVIEW: compatible capacitor on SIN uses C*dV/dt, not a fabricated 0 A',()=>{
  const c=circuitFromBranches([
    ['C1','C','a','0',{value:'1u',ic:'5'}],['R1','R','a','0',{value:'1k'}],
    ['V1','V','a','0',{mode:'SIN',dc:'0',offset:'5',amplitude:'2',frequency:'1k',phase:'0'}],
  ]);
  const r=transient(c),i=r.points[0].componentCurrents;close(i.C1,1e-6*2*2*Math.PI*1000);close(i.V1+i.R1+i.C1,0);
});
test('REVIEW: unsupported OPAMP plus redundant capacitor derivative explicitly fails',()=>{
  const c=parallel();
  c.components.push({id:'U1',type:'OPAMP',props:{gain:'100k'}},{id:'Raux',type:'R',props:{value:'1k'}});
  for(let pin=0;pin<2;pin++) c.wires.push({id:`U${pin}`,a:{componentId:'U1',pin},b:{componentId:'G1',pin:0}});
  c.wires.push({id:'Uout',a:{componentId:'U1',pin:2},b:{componentId:'Raux',pin:0}},{id:'RauxReturn',a:{componentId:'Raux',pin:1},b:{componentId:'G1',pin:0}});
  assert.throws(()=>transient(c),e=>e.code==='INITIAL_DERIVATIVE_UNSUPPORTED');
});
test('REVIEW: AC points/decade rejects zero and fractions instead of a one-point false sweep',()=>{
  const c=cloneExample('rc-lowpass').circuit;
  for(const value of [0,.1,.49,1.5,-1])assert.throws(()=>simulateAC(c,{pointsPerDecade:value}));
});
test('REVIEW: AC total sample limit rejects huge frequency ranges',()=>{
  assert.throws(()=>simulateAC(cloneExample('rc-lowpass').circuit,{startFrequency:'1e-100',endFrequency:'1e100',pointsPerDecade:200}),e=>e.code==='TOO_MANY_POINTS');
});
test('REVIEW: magic component types are rejected as unknown',()=>{
  const c=cloneExample('divider').circuit;c.components[0].type='constructor';assert.throws(()=>validateCircuitStructure(c),e=>e.code==='UNKNOWN_COMPONENT');
});
test('REVIEW: a nonfinite placement coordinate is rejected on import',()=>{
  const c=cloneExample('divider').circuit;c.components[0].x='bad';assert.throws(()=>validateCircuitStructure(c));
});
test('REVIEW: deleting a component also removes probes anchored to its removed wires',()=>{
  const c=cloneExample('divider').circuit;const probes=[{key:'p',kind:'voltage',componentId:'R2',pin:0,wireId:'W2',label:'out',color:'#123456'}];
  const changed=deleteComponentFromCircuit(c,'R1',probes); assert.equal(changed.probes.length,0);assert.equal(c.components.length,4);
  const restored=deserializeProject(serializeProject({circuit:changed.circuit,settings:{analysis:'dc'},probes:changed.probes}));assert.equal(restored.circuit.components.length,3);
});
test('REVIEW: JSON rejects executable CSS/HTML color payloads',()=>{
  const c=cloneExample('divider').circuit; const p={key:'p',kind:'voltage',componentId:'R2',pin:0,label:'out',color:'red" onmouseover="window.__mark=1'};
  assert.throws(()=>deserializeProject(serializeProject({circuit:c,settings:{analysis:'dc'},probes:[p]})));
  for(const value of ['#123456','navy','rgb(20, 30, 40)','hsl(10, 40%, 30%)'])assert.equal(isSafeColor(value),true,value);
  for(const value of ['url(https://example.invalid)','red;position:fixed','red" onload="1'])assert.equal(isSafeColor(value),false);
});
test('REVIEW: HTML escaping preserves inert visible label text',()=>{
  assert.equal(escapeHtml('<x a="&\'">'),'&lt;x a=&quot;&amp;&#39;&quot;&gt;');
});
test('REVIEW: JSON rejects duplicate probe keys and invalid settings',()=>{
  const c=cloneExample('divider').circuit,p={key:'p',kind:'current',componentId:'R1',label:'I',color:'#123456'};
  assert.throws(()=>deserializeProject(serializeProject({circuit:c,settings:{analysis:'dc'},probes:[p,p]})));
  assert.throws(()=>deserializeProject(serializeProject({circuit:c,settings:{analysis:'alien'},probes:[]})));
});
test('REVIEW: shared disjoint sets joins paths and rejects missing nodes',()=>{
  const u=new UnionFind(['a','b','c']);u.union('a','b');u.union('b','c');assert.equal(u.find('a'),u.find('c'));assert.throws(()=>u.find('unknown'));
});
test('REVIEW: 1-2-5 divisions traverse both directions',()=>{
  close(step125(.001,1),.002);close(step125(.002,1),.005);close(step125(.005,1),.01);close(step125(.001,-1),.0005);close(step125(.0005,-1),.0002);
});
test('REVIEW: automatic axes contain values, use eight divisions and handle zero',()=>{
  for(const values of [[0,5],[-2,8],[0,0],[1e-6,3e-6],[-100,-1],[]]){
    const a=fittedAxis(values);close((a.maximum-a.minimum)/a.division,8,1e-8);
    for(const value of values)assert.ok(value>=a.minimum-1e-15&&value<=a.maximum+1e-15);
  }
});
test('REVIEW: logarithmic X fit and zoom keep their anchor',()=>{
  const a=fittedXAxis([10,100,1000],true);close(a.minimum,1);close((a.maximum-a.minimum)/a.division,10);
  const b=zoomAxis(a,-1,.3,10);close(a.minimum+.3*(a.maximum-a.minimum),b.minimum+.3*(b.maximum-b.minimum));assert.equal(b.automatic,false);
});
test('REVIEW: cursor selects actual nearest sample for nonuniform time and AC endpoints',()=>{
  assert.equal(nearestSampleIndex([0,.001,.002,.0025],.00249),3);assert.equal(nearestSampleIndex([10,100,1000],101),1);assert.equal(nearestSampleIndex([0,1],0),0);assert.equal(nearestSampleIndex([],1),null);
});
test('REVIEW: display reduction retains narrow extrema and gaps without mutating samples',()=>{
  const x=Array.from({length:10000},(_,i)=>i), y=x.map(()=>0);y[101]=17;y[102]=-20;y[6000]=NaN;
  const i=extremaIndices(x,y,0,9999,100);assert.ok(i.includes(101)&&i.includes(102)&&i.includes(6000));assert.ok(i.length<1000);assert.equal(y.length,10000);
});
test('REVIEW: engineering text handles zero, femto and large powers without truncation',()=>{
  assert.equal(engineering(0,'s'),'0 s');assert.equal(engineering(.005,'A'),'5 mA');assert.equal(engineering(1e-15,'F'),'1 fF');assert.equal(engineering(1e10,'Hz'),'10 GHz');assert.equal(engineering(-45,'°'),'-45 °');
});
test('REVIEW: auto analysis chooses sensible intent without altering circuit or initial conditions',()=>{
  const c=cloneExample('rc-charge').circuit,before=structuredClone(c);const p=suggestAnalysis(c,{analysis:'dc'},'auto');assert.equal(p.settings.analysis,'transient');assert.ok(Number(p.settings.end)<.1);assert.deepEqual(c,before);
  assert.equal(suggestAnalysis(cloneExample('divider').circuit,{analysis:'ac'},'auto').settings.analysis,'dc');
});
test('REVIEW: expert settings stay exact and automatic AC never rewrites SIN or IC',()=>{
  const c=cloneExample('parallel-sine').circuit, before=structuredClone(c);const previous={analysis:'transient',start:'1m',end:'3m',step:'3u'};
  assert.deepEqual(suggestAnalysis(c,previous,'manual').settings,previous);assert.equal(suggestAnalysis(c,previous,'ac').settings.analysis,'ac');assert.deepEqual(c,before);
});
test('REVIEW: displayed current scale does not change raw CSV values',()=>{
  const result=simulateDC(cloneExample('divider').circuit);const series=[{probe:{kind:'current',label:'I(R1)'},raw:[.005],values:[5],unit:'mA'}];
  const csv=parseCSV(buildResultsCSV(result,series));assert.equal(Number(csv[1][1]),.005);
});
