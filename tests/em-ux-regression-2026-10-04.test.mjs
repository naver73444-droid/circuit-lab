import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createPointChargeEditor } from '../src/em-playground-state.js';

// Exercise the actual UI creation handler against the real state editor.
const controller=await readFile(new URL('../src/em-controller.js',import.meta.url),'utf8');
const body=controller.match(/if\(event.target.id==='em-pg-add-finite'\|\|event.target.id==='em-pg-add-infinite'\)\{([\s\S]*?)\n      \}/)[1];
for(const plane of ['xy','xz','yz']) test(`new lines expose separated handles in ${plane.toUpperCase()}`,()=>{
  for(const kind of ['finite','infinite']){
    const playground=createPointChargeEditor();playground.setPlane(plane);const pg=playground.state;
    let refreshes=0;
    vm.runInNewContext('(function(){'+body+'})()',{event:{target:{id:'em-pg-add-'+kind}},playground,pg,refreshPlayground(){refreshes++;}});
    const source=pg.sources.find(s=>s.id===pg.selectedId),axes=plane==='xy'?[0,1]:plane==='xz'?[0,2]:[1,2];
    assert.equal(refreshes,1);
    if(kind==='finite')assert.ok(axes.some(axis=>source.start[axis]!==source.end[axis]));
    else assert.ok(axes.some(axis=>source.direction[axis]!==0));
    assert.equal(source.type,kind+'-line');
  }
});

