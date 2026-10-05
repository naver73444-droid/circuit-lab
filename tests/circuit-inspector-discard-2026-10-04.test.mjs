import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { InputDrafts } from '../src/input-drafts.js';
import { classifyNumericInput } from '../src/circuit-edit.js';
import { controlledSourceInputModel } from '../src/ui-model.js';

const source=readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
function between(start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,'Current app handler boundary exists');
  return source.slice(a+start.length,b);
}
const commitBody=between('const commitControl = () => {','\n    };\n    if (control.tagName');
const discardBody=between('document.getElementById("discard-drafts-button").addEventListener("click", () => {','\n  });\n  document.addEventListener("click"');
const activeExpression=source.match(/const isCircuitUiActive = \(\) => ([^;]+);/)[1];

function harness({renderThrows=false}={}){
  const component={id:'R1',type:'R',props:{value:'1k'}};
  const state={circuit:{components:[component]},inlineEdit:null,history:[]};
  const drafts=new InputDrafts();drafts.set('prop','R1','value','2k','1k');
  const control={dataset:{prop:'value'},value:'2k',tagName:'INPUT',classList:{add(){}}};
  const context=vm.createContext({state,inputDrafts:drafts,selected:{id:'R1'},control,
    circuitWorkspaceActive:true,workspaceSwitching:false,discardingInputDrafts:false,
    elements:{'inline-value-editor':{classList:{add(){}}},'csv-button':{}},
    controlledSourceInputModel,classifyNumericInput,
    mutate(action){state.history.push(component.props.value);action();},
    updateDraftNotice(){},scheduleAutoRun(){},setStatus(){},renderInspector(){},
    renderAll(){vm.runInContext('commitControl()',context);if(renderThrows)throw new Error('render failure');},
  });
  vm.runInContext(`const isCircuitUiActive=()=>${activeExpression};const commitControl=()=>{${commitBody}};const discard=()=>{${discardBody}};`,context);
  return {component,state,drafts,commit:()=>vm.runInContext('commitControl()',context),discard:()=>vm.runInContext('discard()',context)};
}

test('focused inspector blur during discard keeps committed property and history',()=>{
  const h=harness();h.discard();
  assert.equal(h.component.props.value,'1k');
  assert.equal(h.state.history.length,0);
  assert.equal(h.drafts.size,0);
});

test('ordinary inspector blur still applies a valid pending value',()=>{
  const h=harness();h.commit();
  assert.equal(h.component.props.value,'2k');
  assert.equal(h.state.history.length,1);
  assert.equal(h.drafts.size,0);
});

test('discard render failure preserves value and permits later ordinary commit',()=>{
  const h=harness({renderThrows:true});
  assert.throws(()=>h.discard(),/render failure/);
  assert.equal(h.component.props.value,'1k');
  assert.equal(h.state.history.length,0);
  h.commit();
  assert.equal(h.component.props.value,'2k');
  assert.equal(h.state.history.length,1);
});
