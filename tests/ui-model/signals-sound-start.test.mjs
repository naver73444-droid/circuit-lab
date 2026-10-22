// Sound-spectrum view with a fake Web Audio + getUserMedia whose answer comes whenever the test says (the microphone prompt
// left open): 소리 끄기 while the prompt is open, another input while it is open, and leaving the lesson during the fade of a
// restart must never leave a microphone track running, and must never sound in a view that is no longer on screen.
// Fake DOM and fake timers (the 80 ms fade only ends when the test fires it); no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundView } from '../../src/signals-sound-view.js';

function fakeNode(tag) {
  const attrs = new Map();
  const node = {
    tag, children: [], style: {}, dataset: {}, hidden: false, textContent: '', className: '', parent: null, listeners: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute(key, value) { attrs.set(key, String(value)); },
    getAttribute: (key) => attrs.get(key) ?? null,
    hasAttribute: (key) => attrs.has(key),
    append(...items) { for (const item of items) { if (typeof item === 'object') item.parent = node; node.children.push(item); } },
    prepend(...items) { for (const item of items) item.parent = node; node.children.unshift(...items); },
    addEventListener(type, fn) { node.listeners[type] = fn; },
    remove() {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
  };
  return node;
}
const walk = (node, visit) => { visit(node); for (const child of node.children ?? []) if (child && child.tag) walk(child, visit); };
const flush = () => new Promise((done) => setImmediate(done)); // every pending promise continuation runs first

// A microphone stream with one track that remembers whether it was stopped.
function fakeStream(label) {
  const track = { label, stopped: false, stop() { this.stopped = true; } };
  return { track, getTracks: () => [track] };
}

// slow: suspend()/resume() only finish when the test calls the queued functions; until then the state stays what it was,
// as in a browser (a context being suspended still reads 'running').
function rig({ slow = false } = {}) {
  const timers = [];
  const requests = []; // open getUserMedia calls: { resolve, reject }
  const sources = [];  // streams that reached createMediaStreamSource
  const contexts = [];
  const suspends = [];
  const resumes = [];
  const audioNode = () => ({ connect() {}, disconnect() {} });
  const param = () => ({ value: 0, targets: [], setTargetAtTime(v) { this.targets.push(v); } });
  class FakeContext {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.currentTime = 0; this.destination = audioNode(); contexts.push(this); }
    resume() {
      if (!slow) { this.state = 'running'; return Promise.resolve(); }
      return new Promise((done) => resumes.push(() => { this.state = 'running'; done(); }));
    }
    suspend() {
      if (!slow) { this.state = 'suspended'; return Promise.resolve(); }
      return new Promise((done) => suspends.push(() => { this.state = 'suspended'; done(); }));
    }
    async close() { this.state = 'closed'; }
    createAnalyser() { return { ...audioNode(), fftSize: 2048, getFloatFrequencyData: (t) => t.fill(-120), getFloatTimeDomainData: (t) => t.fill(0) }; }
    createGain() { return { ...audioNode(), gain: param() }; }
    createOscillator() { const osc = { ...audioNode(), frequency: param(), type: 'sine', start() {}, stop() {}, setPeriodicWave() {} }; this.osc = osc; return osc; }
    createPeriodicWave() { return {}; }
    createMediaStreamSource(stream) { sources.push(stream); return audioNode(); }
  }
  const win = {
    AudioContext: FakeContext,
    navigator: { mediaDevices: { getUserMedia: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) } },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
  };
  const doc = { defaultView: win, createElement: fakeNode, createElementNS: (ns, tag) => fakeNode(tag), createTextNode: (data) => ({ data }) };
  const view = createSoundView({ doc, parent: fakeNode('div') });
  let button = null;
  walk(view.root, (n) => { if (n.getAttribute?.('data-signals-sound-toggle') !== null && n.tag === 'button') button = n; });
  const state = (input, extra = {}) => ({ family: 'square', params: { f0: 440, d: 0.25, gain: 10, input, ...extra } });
  return {
    view, requests, sources, contexts, suspends, resumes, state,
    mode: () => view.root.dataset.signalsSound,
    label: () => button.textContent,
    click: () => button.listeners.click(),
    // let the fades end (fake 80 ms timers), then every continuation
    async fire() { for (let i = 0; i < 4; i++) { await flush(); while (timers.length) timers.shift()(); } await flush(); },
  };
}

test('소리 끄기 while the microphone prompt is open cancels the start; the track that arrives later is stopped at once', async () => {
  const r = rig();
  r.view.update(r.state(1));
  r.click();
  await flush();
  assert.equal(r.mode(), 'starting');
  assert.equal(r.label(), '소리 끄기', 'the stop label is shown while waiting');
  assert.equal(r.requests.length, 1, 'the microphone was asked for');
  r.click(); // 소리 끄기 during the prompt
  assert.equal(r.mode(), 'off');
  const late = fakeStream('late');
  r.requests[0].resolve(late);
  await r.fire();
  assert.equal(late.track.stopped, true, 'the late microphone track is stopped');
  assert.equal(r.sources.length, 0, 'it never reached the analyser');
  assert.equal(r.mode(), 'off', 'and nothing started');
  assert.equal(r.contexts[0].state, 'suspended', 'the audio device sleeps again');
  // a refusal that arrives after 소리 끄기 is not shown as an error either
  r.click();
  await flush();
  r.click();
  r.requests[1].reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
  await r.fire();
  assert.equal(r.mode(), 'off');
});

test('another input while the prompt is open: the new input starts, the old request\'s track is stopped when it arrives', async () => {
  const r = rig();
  r.view.update(r.state(1));
  r.click();
  await flush();
  assert.equal(r.requests.length, 1);
  r.view.update(r.state(0)); // back to loopback while the prompt is still open
  await r.fire();
  assert.equal(r.mode(), 'running', 'loopback runs at once');
  const old = fakeStream('old');
  r.requests[0].resolve(old);
  await r.fire();
  assert.equal(old.track.stopped, true, 'the microphone of the old request goes off');
  assert.equal(r.sources.length, 0, 'loopback never listens to the microphone');
  assert.equal(r.mode(), 'running', 'the loopback keeps running');

  // microphone → microphone only while the prompt is open: two requests, only the newer one is kept
  const s = rig();
  s.view.update(s.state(1));
  s.click();
  await flush();
  s.view.update(s.state(2));
  await flush();
  assert.equal(s.requests.length, 2, 'the new input asks again');
  const newer = fakeStream('newer');
  const older = fakeStream('older');
  s.requests[1].resolve(newer);
  await s.fire();
  s.requests[0].resolve(older);
  await s.fire();
  assert.equal(s.mode(), 'running');
  assert.deepEqual(s.sources, [newer], 'only the newer stream feeds the analyser');
  assert.equal(older.track.stopped, true);
  assert.equal(newer.track.stopped, false);
  s.view.suspend();
  assert.equal(newer.track.stopped, true, 'leaving the lesson stops the microphone at once (no fade for it)');
  // slider changes during the prompt do not ask again; they are applied when the microphone arrives
  const t = rig();
  t.view.update(t.state(1));
  t.click();
  await flush();
  t.view.update(t.state(1, { f0: 500 }));
  await flush();
  assert.equal(t.requests.length, 1, 'no second prompt for a slider');
  t.requests[0].resolve(fakeStream('mic'));
  await t.fire();
  assert.equal(t.mode(), 'running');
  assert.equal(t.contexts[0].osc.frequency.targets.at(-1), 500, 'the tone follows the slider that moved during the prompt');
});

test('leaving the lesson during a restart (input changed while sounding) never starts the microphone in the hidden view', async () => {
  // suspend() during the 80 ms fade of the restart
  const r = rig();
  r.view.update(r.state(0));
  r.click();
  await r.fire();
  assert.equal(r.mode(), 'running');
  r.view.update(r.state(1)); // loopback → microphone while sounding: fade out, then start again
  assert.equal(r.mode(), 'starting');
  r.view.suspend(); // the lesson is left before the fade is over
  assert.equal(r.mode(), 'off');
  await r.fire();
  assert.equal(r.requests.length, 0, 'the restart was cancelled: no microphone request at all');
  assert.equal(r.mode(), 'off');
  assert.equal(r.contexts[0].state, 'suspended');

  // suspend() after the fade, while the restart's microphone prompt is open
  const s = rig();
  s.view.update(s.state(0));
  s.click();
  await s.fire();
  s.view.update(s.state(1));
  await s.fire();
  assert.equal(s.requests.length, 1, 'the restart asked for the microphone');
  s.view.suspend();
  const late = fakeStream('late');
  s.requests[0].resolve(late);
  await s.fire();
  assert.equal(late.track.stopped, true, 'the microphone that arrives after leaving is stopped');
  assert.equal(s.sources.length, 0);
  assert.equal(s.mode(), 'off');

  // 소리 끄기 during the fade cancels the restart too
  const t = rig();
  t.view.update(t.state(0));
  t.click();
  await t.fire();
  t.view.update(t.state(1));
  assert.equal(t.label(), '소리 끄기');
  t.click();
  await t.fire();
  assert.equal(t.requests.length, 0);
  assert.equal(t.mode(), 'off');

  // and a restart that nobody interrupts does start the microphone
  const u = rig();
  u.view.update(u.state(0));
  u.click();
  await u.fire();
  u.view.update(u.state(1));
  await u.fire();
  const mic = fakeStream('mic');
  u.requests[0].resolve(mic);
  await u.fire();
  assert.equal(u.mode(), 'running');
  assert.deepEqual(u.sources, [mic]);
  u.click();
  assert.equal(mic.track.stopped, true, '소리 끄기 stops the microphone track');
  await u.fire();
  assert.equal(u.contexts[0].state, 'suspended');
});

test('소리 끄기 → (the fade\'s suspend still under way) → 소리 켜기: the start waits for the suspend, then resumes the context', async () => {
  const r = rig({ slow: true });
  r.view.update(r.state(0));
  r.click();
  await flush();
  r.resumes.shift()();
  await r.fire();
  assert.equal(r.mode(), 'running');
  assert.equal(r.contexts[0].state, 'running');
  r.click(); // 소리 끄기
  await r.fire(); // the 80 ms fade ends and asks the context to sleep ...
  assert.equal(r.suspends.length, 1, 'the fade began a suspend');
  assert.equal(r.contexts[0].state, 'running', '... which has not finished yet');
  r.click(); // 소리 켜기 while that suspend is still under way
  await r.fire();
  assert.equal(r.mode(), 'starting', 'the start waits for the suspend');
  r.suspends.shift()();
  await r.fire();
  assert.equal(r.contexts[0].state, 'suspended');
  assert.equal(r.resumes.length, 1, 'then resumes the context it found asleep');
  r.resumes.shift()();
  await r.fire();
  assert.equal(r.mode(), 'running');
  assert.equal(r.contexts[0].state, 'running', 'sounding with a running context');
  assert.equal(r.suspends.length, 0, 'and nothing puts it to sleep afterwards');
});

test('destroy() while the prompt is open: the late track is stopped as well', async () => {
  const r = rig();
  r.view.update(r.state(2));
  r.click();
  await flush();
  r.view.destroy();
  const late = fakeStream('late');
  r.requests[0].resolve(late);
  await r.fire();
  assert.equal(late.track.stopped, true);
  assert.equal(r.sources.length, 0);
});
