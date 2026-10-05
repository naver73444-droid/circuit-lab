import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PANEL_SPECS, normalizeLayout, movePanel, orderedPanels, dropDock} from '../src/panel-layout.js';
import {distanceToSegment} from '../src/touch-targets.js';
import {installResizeHandle} from '../src/split-view.js';

test('six independent panel preferences include waveform, observation, port and phasor', () => {
  assert.deepEqual(PANEL_SPECS.map(x=>x.id),['palette','inspector','analysis','wave','port','phasor']);
  assert.equal(normalizeLayout(null).panels.port.visible,false);
});
test('unknown versions, invalid numbers and unexpected panel names are not persisted', () => {
  assert.deepEqual(normalizeLayout({version:99,panels:{palette:{dock:'bottom'}}}),normalizeLayout(null));
  const x=normalizeLayout({version:1,panels:{injected:{dock:'left'},palette:{dock:'floating',size:Infinity,visible:'yes',order:-20}},sizes:{left:-100,right:Infinity}});
  assert.equal(Object.hasOwn(x.panels,'injected'),false);assert.equal(x.panels.palette.dock,'left');assert.equal(x.panels.palette.order,0);assert.equal(x.sizes.left,190);
});
test('valid presentation preferences round trip separately from circuit JSON', () => {
  const original=movePanel(normalizeLayout(null),'port','bottom');original.panels.port.visible=true;original.panels.inspector.mobileEdge='top';
  assert.deepEqual(normalizeLayout(JSON.parse(JSON.stringify(original))),original);
  assert.equal('circuit' in original,false);
});
test('moving a panel never mutates the input preferences', () => {
  const x=normalizeLayout(null), before=JSON.stringify(x);const next=movePanel(x,'inspector','left');
  assert.equal(JSON.stringify(x),before);assert.equal(next.panels.inspector.dock,'left');assert.deepEqual(orderedPanels(next,'left'),['palette','inspector']);
});
test('move before/after stays in bounds, preserving all six unique IDs', () => {
  let x=normalizeLayout(null);x=movePanel(x,'inspector','left');x=movePanel(x,'inspector','left',-1);
  assert.deepEqual(orderedPanels(x,'left'),['inspector','palette']);
  for(let i=0;i<20;i++)x=movePanel(x,'inspector','left',-1);
  assert.deepEqual(orderedPanels(x,'left'),['inspector','palette']);
  assert.equal(new Set(['left','right','bottom'].flatMap(d=>orderedPanels(x,d))).size,6);
});
test('dragging to the circuit center is a cancel, not a guessed dock', () => {
  const r={x:10,y:30,width:1000,height:600};
  assert.equal(dropDock({x:100,y:100},r),'left');assert.equal(dropDock({x:900,y:100},r),'right');assert.equal(dropDock({x:500,y:550},r),'bottom');assert.equal(dropDock({x:500,y:300},r),null);assert.equal(dropDock({x:-100,y:300},r),null);
});
test('screen-space hit tests cover a rotated body and clamp to segment ends', () => {
  assert.equal(distanceToSegment({x:5,y:25},{x:0,y:0},{x:0,y:50}),5);
  assert.equal(distanceToSegment({x:60,y:0},{x:0,y:0},{x:40,y:0}),20);
  assert.equal(distanceToSegment({x:3,y:4},{x:0,y:0},{x:0,y:0}),5);
  assert.equal(distanceToSegment({x:NaN,y:0},{x:0,y:0},{x:0,y:1}),Infinity);
});
class Handle {
  constructor(){this.handlers={};this.attrs={};this.classList={add(){},remove(){}};this.capture=null;}
  addEventListener(n,f){this.handlers[n]=f;} setAttribute(n,v){this.attrs[n]=v;}
  setPointerCapture(n){this.capture=n;}hasPointerCapture(n){return this.capture===n;}releasePointerCapture(){this.capture=null;}
  send(n,p={}){this.handlers[n]?.({pointerId:1,button:0,clientX:0,clientY:0,preventDefault(){},stopPropagation(){},...p});}
}
test('resize pointercancel restores size and releases pointer ownership', () => {
  let size=300;const h=new Handle();const resize=installResizeHandle(h,()=>({enabled:true,orientation:'horizontal',direction:-1,bounds:[120,800],initial:300,read:()=>size,write:x=>size=x}));
  h.send('pointerdown',{clientY:500});h.send('pointermove',{clientY:450});assert.equal(size,350);
  h.send('pointercancel');assert.equal(size,300);assert.equal(h.capture,null);resize.cancel();assert.equal(size,300);
});
test('resize keyboard direction changes with top/bottom placement', () => {
  let size=300,direction=-1;const h=new Handle();installResizeHandle(h,()=>({enabled:true,orientation:'horizontal',direction,bounds:[120,800],initial:300,read:()=>size,write:x=>size=x}));
  h.send('keydown',{key:'ArrowUp'});assert.equal(size,312);direction=1;h.send('keydown',{key:'ArrowUp'});assert.equal(size,300);h.send('keydown',{key:'Home'});assert.equal(size,300);
});
test('every panel has a recovery shelf entry and exactly one original result container', async () => {
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const s of PANEL_SPECS){assert.equal((html.match(new RegExp(`id="${s.element}"`,'g'))??[]).length,1);assert.equal((html.match(new RegExp(`data-panel-trigger="${s.id}"`,'g'))??[]).length,1);}
  assert.doesNotMatch(html,/id="phasor-details"|id="result-tabs"|id="pane-switch"/);
});
test('summary runner explicitly requests TAP and preserves failure exit status', async () => {
  const source=await readFile(new URL('../scripts/test-budget.mjs',import.meta.url),'utf8');assert.match(source,/--test-reporter=tap/);assert.match(source,/process.exitCode=summary.exitCode/);
});
