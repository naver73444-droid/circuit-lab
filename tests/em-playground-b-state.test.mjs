import test from 'node:test';
import assert from 'node:assert/strict';
import { createPointChargeEditor } from '../src/em-playground-state.js';

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
