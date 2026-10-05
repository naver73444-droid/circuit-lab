import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {distanceToSegment} from '../src/touch-targets.js';

test('screen-space hit tests cover a rotated body and clamp to segment ends', () => {
  assert.equal(distanceToSegment({x:5,y:25},{x:0,y:0},{x:0,y:50}),5);
  assert.equal(distanceToSegment({x:60,y:0},{x:0,y:0},{x:40,y:0}),20);
  assert.equal(distanceToSegment({x:3,y:4},{x:0,y:0},{x:0,y:0}),5);
  assert.equal(distanceToSegment({x:NaN,y:0},{x:0,y:0},{x:0,y:1}),Infinity);
});
test('every editor panel exists exactly once; the waveform and result panes are the only result containers', async () => {
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const id of ['palette-panel','inspector-panel','results-panel','wave-panel','phasor-panel','port-panel'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))??[]).length,1,id);
  assert.doesNotMatch(html,/id="phasor-details"|id="result-tabs"|id="pane-switch"|id="analysis-panel"|data-panel-trigger/);
});
test('inline <style> blocks and the separate em-ux stylesheet are gone; one stylesheet remains', async () => {
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.equal((html.match(/<style/g)??[]).length,0);
  assert.equal((html.match(/rel="stylesheet"/g)??[]).length,1);
  const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
  for(const marker of ['EM UX 2026-10-04','em-course','circuit-course-shell','#signals-workspace'])assert.ok(css.includes(marker),marker);
});
test('summary runner explicitly requests TAP and preserves failure exit status', async () => {
  const source=await readFile(new URL('../scripts/test-budget.mjs',import.meta.url),'utf8');assert.match(source,/--test-reporter=tap/);assert.match(source,/process.exitCode=summary.exitCode/);
});
