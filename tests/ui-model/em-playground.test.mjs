import test from "node:test";
import assert from "node:assert/strict";
import { createPointChargeEditor } from "../../src/em-playground-state.js";
import { intersectEditingPlane, screenRay } from "../../src/em-playground-interaction.js";
import { EM_PROJECT_MAX_BYTES, makeExampleProject, parseEMProject, serializeEMProject } from "../../src/em-playground-project.js";

const source = (id, q, position) => ({ id, type: 'point', q, position, enabled: true, visible: true });

test('draft preserves invalid text, blocks drag, then atomically applies zero', () => {
  const editor = createPointChargeEditor({ sources: [source('fixed', 1e-9, [0, 0, 0])], selectedId: 'fixed' });
  editor.beginDraft(); editor.setDraft('q', '');
  assert.equal(editor.state.draft.q, '');
  assert.equal(editor.beginDrag('fixed'), false);
  editor.select(null);
  editor.setProbe([1, 1, 0]);
  editor.setPlane('xz');
  assert.equal(editor.state.draft.q, '');
  assert.equal(editor.state.previous, true);
  assert.match(editor.state.error, /빈값|미확정|적용/);
  assert.equal(editor.undo(), false);
  editor.select('fixed');
  assert.deepEqual(editor.state.sources[0].position, [0, 0, 0]);
  editor.setDraft('q', '0'); editor.setDraft('x', '1');
  assert.equal(editor.applyDraft(), true);
  assert.equal(editor.state.sources[0].q, 0);
  assert.deepEqual(editor.state.sources[0].position, [1, 0, 0]);
});

test('one drag is one history item; cancel adds none; undo and redo preserve stable ID', () => {
  const editor = createPointChargeEditor({ sources: [source('stable', 1e-9, [0, 0, 0])], selectedId: 'stable' });
  const beforeRevision = editor.state.revision;
  assert.equal(editor.beginDrag('stable', 'xy'), true);
  editor.previewDrag([0.25, 0.5, 0]); editor.previewDrag([0.5, 0.75, 0]);
  assert.equal(editor.commitDrag([1, 1, 0]), true);
  assert.equal(editor.state.past.length, 1);
  assert.deepEqual(editor.state.sources[0], source('stable', 1e-9, [1, 1, 0]));
  assert.ok(editor.state.revision > beforeRevision);
  editor.undo(); assert.deepEqual(editor.state.sources[0].position, [0, 0, 0]); assert.equal(editor.state.sources[0].id, 'stable');
  editor.redo(); assert.deepEqual(editor.state.sources[0].position, [1, 1, 0]); assert.equal(editor.state.sources[0].id, 'stable');
  const history = editor.state.past.length;
  editor.beginDrag('stable', 'xz'); editor.previewDrag([2, 1, 2]); editor.cancelDrag();
  assert.deepEqual(editor.state.sources[0].position, [1, 1, 0]); assert.equal(editor.state.past.length, history);
  editor.beginDrag('stable', 'xy'); editor.previewDrag([1.5, 1.5, 0]);
  assert.equal(editor.commitDrag([21, 0, 0]), false); assert.equal(editor.state.drag, null); assert.deepEqual(editor.state.sources[0].position, [1, 1, 0]); assert.equal(editor.state.past.length, history);
});

test('clone gets a fresh ID; deletion clears selection and undo restores exact target', () => {
  const editor = createPointChargeEditor({ sources: [source('q9', 1e-9, [0, 0, 0])], selectedId: 'q9' });
  const cloneId = editor.cloneSelected();
  assert.notEqual(cloneId, 'q9'); assert.equal(new Set(editor.state.sources.map(item => item.id)).size, 2);
  editor.removeSelected(); assert.equal(editor.state.selectedId, null); assert.equal(editor.state.sources.length, 1);
  editor.undo(); assert.equal(editor.state.sources.length, 2); assert.equal(editor.state.selectedId, cloneId);
});

test('clone at the coordinate boundary reports an error without leaking or mutating', () => {
  const editor = createPointChargeEditor({ sources: [source('edge', 1e-9, [20, 0, 0])], selectedId: 'edge' });
  assert.equal(editor.cloneSelected(), null);
  assert.equal(editor.state.sources.length, 1);
  assert.match(editor.state.error, /±20 m/);
});

test('comparison is a deep immutable snapshot and stale calculation tokens change on cancellation', () => {
  const editor = createPointChargeEditor({ sources: [source('q1', 1e-9, [0, 0, 0])], selectedId: 'q1' });
  const comparison = editor.captureComparison();
  const oldToken = editor.state.calculationToken;
  editor.beginDrag('q1'); editor.previewDrag([1, 0, 0]); editor.cancelDrag();
  assert.deepEqual(comparison.sources[0].position, [0, 0, 0]);
  assert.deepEqual(editor.state.comparison.sources[0].position, [0, 0, 0]);
  assert.ok(editor.state.calculationToken > oldToken);
});

test('plane ray intersection fixes its normal coordinate and rejects parallel rays', () => {
  const ray = screenRay({ left: 0, top: 0, width: 800, height: 600 }, 400, 300, { yaw: 0, pitch: 0.5, distance: 7 });
  const point = intersectEditingPlane(ray, 'xy', 0.25);
  assert.ok(point); assert.equal(point[2], 0.25);
  const screenRight = screenRay({ left: 0, top: 0, width: 800, height: 600 }, 600, 300, { yaw: 0, pitch: 0.5, distance: 7 });
  assert.ok(screenRight.direction[1] > ray.direction[1], 'positive screen x must follow em-view lookAt screen-right basis');
  assert.equal(intersectEditingPlane({ origin: [0, 0, 1], direction: [1, 0, 0] }, 'xy', 0), null);
});

test('pure EM editor operations do not mutate an unrelated caller-owned object', () => {
  const circuit = { components: [{ id: 'R1', value: 1000 }], valueDraft: { id: 'R1', text: '2k' }, probe: { kind: 'voltage', ref: 'R1' }, history: ['draw'] };
  const before = structuredClone(circuit);
  const editor = createPointChargeEditor();
  editor.add(1e-9, [0, 0, 1]); editor.beginDrag(editor.state.selectedId, 'xz'); editor.previewDrag([1, 0, 1]); editor.cancelDrag(); editor.undo(); editor.redo();
  assert.deepEqual(circuit, before);
});

test('finite and infinite line drafts apply atomically and preserve stable IDs',()=>{
  const editor=createPointChargeEditor({sources:[]});const finite=editor.addFiniteLine();editor.beginDraft(finite);editor.setDraft('lambda','2');editor.setDraft('bz','2');assert.equal(editor.applyDraft(),true);let source=editor.state.sources[0];assert.equal(source.id,finite);assert.equal(source.lambda,2e-9);assert.deepEqual(source.end,[0,0,2]);
  const infinite=editor.addInfiniteLine();editor.beginDraft(infinite);editor.setDraft('dx','0');editor.setDraft('dy','1');editor.setDraft('dz','0');editor.setDraft('sRef','2');assert.equal(editor.applyDraft(),true);source=editor.state.sources[1];assert.deepEqual(source.direction,[0,1,0]);assert.equal(source.sRef,2);
});

test('finite body and endpoints are distinct one-history drag transactions',()=>{
  const editor=createPointChargeEditor({sources:[]}),id=editor.addFiniteLine();const baseHistory=editor.state.past.length;
  editor.beginDrag(id,'xy','body',[0,0,0]);editor.previewDrag([1,2,0]);editor.commitDrag([1,2,0]);let line=editor.state.sources[0];assert.deepEqual(line.start,[1,2,-1]);assert.deepEqual(line.end,[1,2,1]);assert.equal(editor.state.past.length,baseHistory+1);
  editor.beginDrag(id,'xz','end',line.end);editor.commitDrag([2,2,2]);line=editor.state.sources[0];assert.deepEqual(line.start,[1,2,-1]);assert.deepEqual(line.end,[2,2,2]);editor.undo();assert.deepEqual(editor.state.sources[0].end,[1,2,1]);
});

test('infinite direction handle normalizes and invalid zero direction restores snapshot',()=>{
  const editor=createPointChargeEditor({sources:[]}),id=editor.addInfiniteLine();const before=structuredClone(editor.state.sources[0]);editor.beginDrag(id,'xy','direction',[0,0,2]);assert.equal(editor.commitDrag([0,2,0]),true);assert.deepEqual(editor.state.sources[0].direction,[0,1,0]);
  editor.beginDrag(id,'xy','direction',editor.state.sources[0].position);assert.equal(editor.commitDrag(editor.state.sources[0].position),false);assert.equal(editor.state.drag,null);assert.deepEqual(editor.state.sources[0].direction,[0,1,0]);assert.notDeepEqual(editor.state.sources[0],before);
});

test('mixed source cap is shared at 16',()=>{
  const editor=createPointChargeEditor({sources:[]});for(let index=0;index<8;index++)assert.ok(editor.add(1e-9,[index/10,0,0]));for(let index=0;index<8;index++)assert.ok(editor.addFiniteLine(1e-9,[index/10,0,-1],[index/10,0,1]));assert.equal(editor.state.sources.length,16);assert.equal(editor.addInfiniteLine(),null);assert.match(editor.state.error,/최대 16개/);
});

const project={format:'circuit-lab-em-playground',version:1,world:{sources:[{id:'point-A',type:'point',q:1e-9,position:[-1,0,0],enabled:true,visible:true},{id:'finite-B',type:'finite-line',lambda:-2e-9,start:[0,0,-1],end:[0,0,1],enabled:true,visible:true},{id:'infinite-C',type:'infinite-line',lambda:3e-9,position:[2,0,0],direction:[0,1,1],sRef:2,displayLength:5,enabled:false,visible:true}],probe:[1,2,3],plane:'xz',selectedId:'finite-B',comparison:{sources:[{id:'old',type:'point',q:-1e-9,position:[0,0,0],enabled:true,visible:true}],probe:[1,0,0]}},view:{camera:{yaw:.4,pitch:-.2,distance:8},vectorMode:'gradV'},calculus:{mode:'rotational',differentialMode:'numeric',alpha:-2,h:.005,radius:.5,normal:[1,1,0]},legend:{mode:'fixed',min:-4,max:9}};

test('D mixed project round-trips every confirmed setting without derived state',()=>{const source=serializeEMProject(project),value=parseEMProject(source);assert.deepEqual(parseEMProject(serializeEMProject(value)),value);assert.deepEqual(value.calculus.normal,[1,1,0]);assert.equal(value.world.sources[2].sRef,2);assert.ok(!source.includes('calculationToken'));assert.ok(!source.includes('history'));});

test('D load replaces editor atomically and resets draft/history',()=>{const editor=createPointChargeEditor();editor.setDraft('q','broken');const before=editor.inspect();assert.throws(()=>editor.replaceWorld({...project.world,sources:[...project.world.sources,{...project.world.sources[0]}]}),/ID/);assert.deepEqual(editor.inspect(),before);editor.cancelDraft();editor.add();assert.ok(editor.state.past.length);const normalized=parseEMProject(serializeEMProject(project));editor.replaceWorld(normalized.world);assert.deepEqual(editor.state.sources,normalized.world.sources);assert.equal(editor.state.past.length,0);assert.equal(editor.state.future.length,0);assert.equal(editor.state.draft,null);assert.equal(editor.state.selectedId,'finite-B');});

test('D rejects coercion, duplicate IDs, dangerous keys and oversized UTF-8 before use',()=>{const stringNumber=structuredClone(project);stringNumber.world.sources[0].q='1e-9';assert.throws(()=>parseEMProject(JSON.stringify(stringNumber)),/유한한 숫자/);const duplicate=structuredClone(project);duplicate.world.sources[1].id='point-A';assert.throws(()=>parseEMProject(JSON.stringify(duplicate)),/ID/);assert.throws(()=>parseEMProject('{"format":"circuit-lab-em-playground","version":1,"__proto__":{}}'),/허용되지 않은 키/);assert.throws(()=>parseEMProject(' '.repeat(EM_PROJECT_MAX_BYTES+1)),/1 MiB/);});

test('D preserves arbitrary nonzero normal and examples use the same schema',()=>{assert.deepEqual(parseEMProject(serializeEMProject(project)).calculus.normal,[1,1,0]);const example=makeExampleProject('curl',project);assert.equal(example.calculus.mode,'rotational');assert.deepEqual(example.world.sources,[]);});

test('D restored huge q-like ID cannot collide with newly allocated IDs',()=>{const editor=createPointChargeEditor({sources:[{id:'q999999999999999999999999',q:1e-9,position:[0,0,0],enabled:true,visible:true}]});assert.equal(editor.add(1e-9,[1,0,0]),'q1');});
