// Electromagnetics workspace. Primary view: a 2D top-down sandbox (drag charges and the test charge, everything
// updates live). Secondary: the same state in 3D, and the problem-solving course (a separate lazy module).
import { createEMState, DEFAULT_SCENES } from './em-state.js';
import { createInteraction } from './em-interaction.js';
import { createPointChargeEditor } from './em-playground-state.js';
import { createCurrentMode, createSandboxMode, createSceneMode } from './em-plane-modes.js';
import { createCurrentEditor } from './em-current-state.js';
import * as currentEdit from './em-current-edit.js';
import { CURRENT_PRESETS, currentPreset } from './em-current-presets.js';
import { clampAmpere } from './em-ampere.js';
import { createPlaneController } from './em-plane-controller.js';
import { create3DPanel } from './em-3d-panel.js';
import { createInspector } from './em-inspector.js';
import { createScenesPanel, sceneTitle } from './em-scenes-panel.js';
import { createCalculusPanel } from './em-calculus-panel.js';
import { createProjectPanel } from './em-project-panel.js';
import { EM_MAGNETIC_CHIPS } from './em-playground-project.js';
import { createPalette, watchReducedMotion } from './em-palette.js';
import { freeSpot } from './em-source-edit.js';
import { planeNormal } from './em-plane-geometry.js';
import { siText } from './em-format.js';

export { parseEMNumber } from './em-source-edit.js';

// The course (lesson registry + topic modules, ~290KB) loads only when it is opened.
// A failed module fetch is cached by the browser, so a retry adds a cache-busting suffix.
let courseModulePromise = null, courseModuleFailures = 0;
function loadEMCourseModule() {
  if (!courseModulePromise) {
    const promise = import('./em-course-controller.js' + (courseModuleFailures ? '?retry=' + courseModuleFailures : ''));
    courseModulePromise = promise;
    promise.catch(() => { if (courseModulePromise === promise) { courseModulePromise = null; courseModuleFailures += 1; } });
  }
  return courseModulePromise;
}
export function prefetchEMCourse() { loadEMCourseModule().catch(() => {}); }

const WAVE_CYCLES_PER_SECOND = 0.5;
// Assigning identical text still invalidates layout; the readouts update on every drag frame.
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const FIELD_KEY = 'circuit-lab.em-field-mode';
const MAGNETIC_ONLY = ['mcolor', 'arrows', 'hfield', 'ampere', 'force'];
const AMPERE_SLIDER = 'em-ampere-size';
const HINTS = {
  current: '도선·루프·판을 끌어 옮기고 노란 측정점으로 B·H를 읽어 보세요 · 암페어 루프(점선)를 끌어 ∮H·dl = I내부 확인 · 휠로 확대',
  sandbox: '전하와 노란 시험전하를 끌어 보세요 · 휠로 확대 · 키보드: [ ] 로 전하 선택, 화살표로 이동',
  scene: '노란 관측점을 끌어 보세요 · 휠로 확대',
  '3d': '빈 곳을 끌면 시점이 돌아갑니다 · 휠로 확대 · 전하는 선택한 평면 위에서 끌 수 있습니다',
};

export function createEMController(root) {
  const events = new AbortController(), listen = { signal: events.signal };
  const $ = selector => root.querySelector(selector);
  const store = createEMState(), s = store.state;
  const editor = createPointChargeEditor(), pg = editor.state;
  // Which field the sandbox shows (전기 / 자기) is remembered for the session only.
  let storedField = 'electric';
  try { if (sessionStorage.getItem(FIELD_KEY) === 'magnetic') storedField = 'magnetic'; } catch { /* storage may be blocked */ }
  const lab = {
    tab: 'plane', scene: 'playground', field: storedField, presetNote: '', presetSources: '',
    chips: { lines: true, contours: true, gauss: false, mcolor: true, arrows: true, hfield: false, ampere: false, force: false },
    gauss: null, ampere: null, view: { span: 3, offset: [0, 0] }, quality: 'final', error: '',
  };
  const interaction = createInteraction();
  const currentEditor = createCurrentEditor(), cs = currentEditor.state;
  const modes = { sandbox: createSandboxMode(editor), scene: createSceneMode(store), current: createCurrentMode(currentEditor, editor) };
  const isMagnetic = () => lab.scene === 'playground' && lab.field === 'magnetic';
  // One pair of undo / redo / reset buttons works on the sources of the field that is showing (each field keeps its own history).
  const activeEditor = () => (isMagnetic() ? currentEditor : editor);
  // Screen-reader announcements (keyboard selection of a source) go to a polite live region.
  const announce = text => { const node = $('#em-live'); if (node) node.textContent = text; };
  const getMode = () => (lab.scene === 'playground' ? (lab.field === 'magnetic' ? modes.current : modes.sandbox) : modes.scene);
  const diagnostics = { frames: 0, suspends: 0, lastDrawMs: 0, lastFrameMs: 0, chromeMs: 0, panelsMs: 0 };
  let frameId = null, destroyed = false, workspaceActive = false, courseActive = false;
  let course = null, coursePending = null, courseStatus = null, playFrame = null, lastTick = 0;

  const palette = createPalette(root, () => { plane.invalidate(); threeD.invalidate(); requestRender(); });
  const getPalette = () => palette.current();
  // The wave never starts by itself (only 재생 does, which stays allowed); "reduce motion" turned on mid-playback stops it.
  const motion = watchReducedMotion(events.signal, () => { if (s.playing) { stopPlayback(); requestRender(); } });
  const requestRender = () => { if (frameId === null && !destroyed) frameId = requestAnimationFrame(flush); };
  const flush = () => { frameId = null; render(); };

  const plane = createPlaneController({
    baseCanvas: $('#em-plane-base'), canvas: $('#em-plane'), editor, getMode, lab, getPalette, onChange: requestRender, signal: events.signal,
    interaction, announce,
  });
  const threeD = create3DPanel({
    canvas: $('#em-canvas'), status: $('#em-renderer-status'), editor, store, lab, getMode, getPalette,
    onChange: requestRender, isActive: () => s.active && lab.tab === '3d', signal: events.signal, interaction,
  });
  const inspector = createInspector({
    host: $('#em-inspector'), editor, request: requestRender, getPlane: () => pg.plane, signal: events.signal,
    announce, focusCanvas: () => $(lab.tab === '3d' ? '#em-canvas' : '#em-plane').focus({ preventScroll: true }),
  });
  const currentInspector = createInspector({
    host: $('#em-current-inspector'), editor: currentEditor, request: requestRender, getPlane: () => pg.plane, signal: events.signal,
    announce, focusCanvas: () => $('#em-plane').focus({ preventScroll: true }), model: currentEdit,
  });
  const scenesPanel = createScenesPanel({
    host: $('#em-model-fields'), store, signal: events.signal,
    onApplied: () => { lab.error = ''; requestRender(); },
    onError: text => { lab.error = text; requestRender(); },
  });
  const calculus = createCalculusPanel({
    root, editor, isSandbox: () => lab.scene === 'playground' && lab.field === 'electric', getPalette, signal: events.signal, interaction,
  });
  // The magnetic mode goes into the EM file too: sources, Ampere loop, the display chips and which field (전기 | 자기) was showing.
  const magneticFile = {
    read: () => ({
      field: lab.field, sources: structuredClone(cs.sources), selectedId: cs.selectedId,
      ampere: lab.ampere ? structuredClone(lab.ampere) : null,
      chips: Object.fromEntries(EM_MAGNETIC_CHIPS.map(name => [name, lab.chips[name] === true])),
    }),
    write: ({ sources, selectedId, ampere, chips }) => {
      currentEditor.replaceWorld({ sources, selectedId });
      lab.ampere = ampere ? structuredClone(ampere) : null;
      if (chips) EM_MAGNETIC_CHIPS.forEach(name => { if (name in chips) lab.chips[name] = chips[name]; });
    },
  };
  const project = createProjectPanel({
    root, editor, store, calculus, magnetic: magneticFile, signal: events.signal,
    // A file or example is applied to the playground in its saved field (examples and version 1 files: 전기).
    onLoaded: file => {
      setScene('playground');
      setFieldMode(file.field);
      lab.gauss = null;
      if (lab.chips.gauss) plane.placeGauss();
      requestRender();
    },
  });

  // ---- one render ------------------------------------------------------------------------------------------------

  function syncChrome() {
    const sandbox = lab.scene === 'playground', mode = getMode(), magnetic = isMagnetic(), electric = sandbox && !magnetic;
    if (magnetic && lab.tab === '3d') lab.tab = 'plane'; // the 3D view only knows the charges
    root.querySelectorAll('[data-em-field-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.emFieldMode === lab.field)));
    $('#em-field-mode').hidden = !sandbox;
    $('#em-current-palette').hidden = !magnetic;
    $('#em-current-presets').hidden = !magnetic;
    MAGNETIC_ONLY.forEach(name => { $(`#em-chip-${name}`).hidden = !magnetic; });
    root.querySelector('[data-em-tab="3d"]').hidden = magnetic;
    root.querySelector('[data-em-chip="lines"]').textContent = magnetic ? '자기장선' : '장선';
    root.querySelectorAll('[data-em-tab]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.emTab === lab.tab)));
    root.querySelectorAll('[data-em-scene]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.emScene === lab.scene)));
    root.querySelectorAll('[data-em-chip]').forEach(button => button.setAttribute('aria-pressed', String(lab.chips[button.dataset.emChip])));
    $('#em-plane').hidden = lab.tab !== 'plane';
    $('#em-plane-base').hidden = lab.tab !== 'plane';
    $('#em-canvas').hidden = lab.tab !== '3d';
    $('#em-3d-bar').hidden = lab.tab !== '3d';
    $('#em-palette').hidden = !electric;
    $('#em-chip-gauss').hidden = !electric;
    $('#em-chip-contours').hidden = lab.tab === '3d';
    const history = activeEditor().state;
    $('#em-pg-undo').hidden = !sandbox;
    $('#em-pg-redo').hidden = !sandbox;
    $('#em-pg-undo').disabled = !history.past.length;
    $('#em-pg-redo').disabled = !history.future.length;
    $('#em-chip-contours').textContent = electric || mode.field().scalarName === 'V' ? '등전위선' : '등크기선';
    $('#em-inspector').hidden = !electric;
    $('#em-current-inspector').hidden = !magnetic;
    $('#em-wave-controls').hidden = lab.scene !== 'wave';
    $('#em-play').textContent = s.playing ? '정지' : '재생';
    // The preset text describes the sources it loaded: after an undo, a drag or any edit it no longer does.
    if (lab.presetNote && JSON.stringify(cs.sources) !== lab.presetSources) lab.presetNote = '';
    $('#em-readout-target').textContent = magnetic ? '측정점 (B · H)' : sandbox ? '시험전하' : sceneTitle(lab.scene);
    $('#em-hint').textContent = lab.tab === '3d' ? HINTS['3d'] : magnetic ? (lab.presetNote || HINTS.current) : sandbox ? HINTS.sandbox : HINTS.scene;
    $('#em-plane').setAttribute('aria-label', magnetic
      ? '전류와 자기장 평면. 도선·루프·판과 노란 측정점, 암페어 루프를 끌어 움직이고, 휠로 확대합니다. 키보드: 대괄호 [ ]로 원천을 고르고 화살표로 옮깁니다.'
      : '전하와 전기장 평면. 전하와 노란 시험전하를 끌어 움직이고, 휠로 확대합니다. 키보드: 대괄호 [ ]로 전하를 고르고 화살표로 옮깁니다.');
    const select = $('#em-pg-plane');
    if (select.value !== mode.plane()) select.value = mode.plane();
    const error = magnetic ? cs.error : sandbox ? pg.error : lab.error || s.error;
    $('#em-error').hidden = !error;
    $('#em-error').textContent = error || '';
  }

  function showReadouts(info) {
    setText($('#em-sensor-text'), info.readout.compact);
    const rows = $('#em-sensor-rows'), rowsKey = JSON.stringify(info.readout.rows);
    if (rows.dataset.key !== rowsKey) {
      rows.dataset.key = rowsKey;
      rows.replaceChildren(...info.readout.rows.flatMap(row => {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = row.label;
        dt.title = row.title ?? '';
        dd.textContent = row.text;
        return [dt, dd];
      }));
    }
    showAmpere(info);
    showForce(info);
    const box = $('#em-gauss-readout');
    box.hidden = !info.gauss;
    if (!info.gauss) return;
    const lines = $('#em-gauss-lines'), linesKey = info.gauss.lines.join('|');
    if (lines.dataset.key !== linesKey) {
      lines.dataset.key = linesKey;
      lines.replaceChildren(...info.gauss.lines.map(text => Object.assign(document.createElement('p'), { textContent: text })));
    }
    lines.dataset.agrees = String(info.gauss.agrees);
    $('#em-gauss-state').textContent = info.gauss.stateText ?? '';
    const slider = $('#em-gauss-radius');
    if (slider !== document.activeElement) slider.value = String(lab.gauss.radius);
    $('#em-gauss-radius-text').textContent = `${Number(lab.gauss.radius.toFixed(2))} m`;
  }

  function fillLines(node, lines, agrees) {
    const key = lines.join('|');
    if (node.dataset.key !== key) {
      node.dataset.key = key;
      node.replaceChildren(...lines.map(text => Object.assign(document.createElement('p'), { textContent: text })));
    }
    node.dataset.agrees = String(agrees);
  }

  function showAmpere(info) {
    const box = $('#em-ampere-readout');
    box.hidden = !info.ampere;
    if (!info.ampere) return;
    fillLines($('#em-ampere-lines'), info.ampere.lines, info.ampere.agrees);
    $('#em-ampere-state').textContent = info.ampere.stateText ?? '';
    root.querySelectorAll('[data-em-ampere-shape]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.emAmpereShape === lab.ampere.shape)));
    $('#em-ampere-turn').textContent = lab.ampere.orientation === -1 ? '시계 ↻' : '반시계 ↺';
    const size = lab.ampere.shape === 'rect' ? lab.ampere.halfWidth : lab.ampere.radius, slider = $(`#${AMPERE_SLIDER}`);
    if (slider !== document.activeElement) slider.value = String(size);
    $('#em-ampere-size-text').textContent = lab.ampere.shape === 'rect'
      ? `${Number((2 * lab.ampere.halfWidth).toFixed(2))} × ${Number((2 * lab.ampere.halfHeight).toFixed(2))} m` : `r = ${Number(lab.ampere.radius.toFixed(2))} m`;
  }

  function showForce(info) {
    const box = $('#em-force-readout');
    box.hidden = !info.force;
    if (!info.force) return;
    setText($('#em-force-target'), info.force.title ?? '');
    fillLines($('#em-force-lines'), info.force.lines, null);
  }

  function showTime() {
    if (lab.scene !== 'wave') return;
    $('#em-time').value = String(s.timeCycles);
    const model = s.models.wave;
    $('#em-time-text').textContent = `t = ${siText(s.timeCycles / model.frequency, 's', 3)} (${s.timeCycles.toFixed(2)} T)`;
  }

  function render() {
    if (destroyed || !s.active) return;
    const started = performance.now();
    syncChrome();
    const chromeDone = performance.now();
    const info = lab.tab === 'plane' ? plane.draw() : (threeD.draw(), plane.measure());
    const drawDone = performance.now();
    diagnostics.frames += 1;
    if (info) showReadouts(info);
    if (isMagnetic()) currentInspector.sync();
    else if (lab.scene === 'playground') inspector.sync();
    else scenesPanel.refresh();
    showTime();
    calculus.update(interaction.active);
    const done = performance.now();
    Object.assign(diagnostics, {
      lastDrawMs: drawDone - started, lastFrameMs: done - started, chromeMs: chromeDone - started, panelsMs: done - drawDone,
    });
  }

  // ---- scenes, playback ------------------------------------------------------------------------------------------

  function stopPlayback() {
    if (playFrame !== null) { cancelAnimationFrame(playFrame); playFrame = null; }
    store.stop();
  }

  function tick(now) {
    if (!s.active || document.hidden || !s.playing) { playFrame = null; return; }
    if (now - lastTick >= 1000 / 30) {
      const dt = Math.min(0.1, (now - lastTick) / 1000 || 0);
      lastTick = now;
      store.setTime((s.timeCycles + dt * WAVE_CYCLES_PER_SECOND) % 2);
      render();
    }
    playFrame = requestAnimationFrame(tick);
  }

  function setScene(name) {
    stopPlayback();
    plane.cancel();
    lab.error = '';
    lab.scene = name;
    if (name !== 'playground') store.setScene(name);
    scenesPanel.show(name === 'playground' ? null : name);
    plane.invalidate();
    threeD.invalidate();
  }

  // ---- events ----------------------------------------------------------------------------------------------------

  function setFieldMode(name) {
    if (name !== 'electric' && name !== 'magnetic') return;
    plane.cancel();
    lab.field = name;
    lab.error = '';
    lab.presetNote = '';
    if (name === 'magnetic' && lab.chips.ampere && !lab.ampere) plane.placeAmpere();
    try { sessionStorage.setItem(FIELD_KEY, name); } catch { /* storage may be blocked */ }
    plane.invalidate();
    threeD.invalidate();
  }

  function addCurrent(kind) {
    const mode = modes.current, spot = currentEdit.freeCurrentSpot(cs.sources, pg.plane, mode.fixed(), pg.probe);
    lab.presetNote = '';
    currentEditor.add(currentEdit.newSource(kind, pg.plane, spot));
  }

  function applyPreset(name) {
    const preset = currentPreset(name, pg.plane);
    if (!preset) return;
    plane.cancel();
    if (!currentEditor.load(preset.sources, preset.selectedId)) return;
    lab.view = { span: preset.view.span, offset: [0, 0] };
    Object.assign(lab.chips, preset.chips);
    lab.ampere = preset.ampere ? clampAmpere(preset.ampere) : null;
    modes.current.moveSensor(preset.sensor);
    lab.presetNote = `${CURRENT_PRESETS[name]}: ${preset.note}`;
    lab.presetSources = JSON.stringify(cs.sources);
    announce(lab.presetNote);
    plane.invalidate();
  }

  function addSource(kind) {
    const mode = modes.sandbox, plane3 = pg.plane;
    const spot = freeSpot(pg.sources, plane3, mode.fixed(), pg.probe);
    const along = plane3 === 'yz' ? [0, 1, 0] : [1, 0, 0];
    const shift = (vector, scale) => spot.map((value, i) => value + vector[i] * scale);
    if (kind === 'finite') editor.addFiniteLine(1e-9, shift(along, -0.75), shift(along, 0.75));
    else if (kind === 'infinite') editor.addInfiniteLine(1e-9, spot, along);
    else editor.add(kind * 1e-9, spot);
  }

  root.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.id === 'em-course-open') { switchCourse(true); return; }
    if (target.dataset.emTab) { lab.tab = target.dataset.emTab; plane.cancel(); threeD.cancel(); requestRender(); return; }
    if (target.dataset.emScene) { setScene(target.dataset.emScene); requestRender(); return; }
    if (target.dataset.emFieldMode) { setFieldMode(target.dataset.emFieldMode); requestRender(); return; }
    if (target.dataset.emCurrentAdd) { addCurrent(target.dataset.emCurrentAdd); requestRender(); return; }
    if (target.dataset.emCurrentPreset) { applyPreset(target.dataset.emCurrentPreset); requestRender(); return; }
    if (target.dataset.emAmpereShape) {
      lab.ampere = clampAmpere({ ...lab.ampere, shape: target.dataset.emAmpereShape });
      requestRender();
      return;
    }
    if (target.id === 'em-ampere-turn') { lab.ampere = { ...lab.ampere, orientation: lab.ampere.orientation === -1 ? 1 : -1 }; requestRender(); return; }
    if (target.dataset.emChip) {
      const name = target.dataset.emChip;
      lab.chips[name] = !lab.chips[name];
      if (name === 'gauss' && lab.chips.gauss && !lab.gauss) plane.placeGauss();
      if (name === 'ampere' && lab.chips.ampere && !lab.ampere) plane.placeAmpere();
      requestRender();
      return;
    }
    if (target.dataset.emView) { threeD.setView(target.dataset.emView); return; }
    if (target.dataset.emPgAdd) { addSource(Number(target.dataset.emPgAdd)); requestRender(); return; }
    if (target.id === 'em-pg-add-finite') { addSource('finite'); requestRender(); return; }
    if (target.id === 'em-pg-add-infinite') { addSource('infinite'); requestRender(); return; }
    if (target.id === 'em-pg-undo') { activeEditor().undo(); requestRender(); return; }
    if (target.id === 'em-pg-redo') { activeEditor().redo(); requestRender(); return; }
    if (target.id === 'em-pg-reset') { resetCurrent(); return; }
    if (target.id === 'em-play') {
      if (s.playing) stopPlayback();
      else { s.playing = true; lastTick = performance.now(); playFrame = requestAnimationFrame(tick); }
      requestRender();
    }
  }, listen);

  function resetCurrent() {
    plane.cancel();
    lab.view = { span: 3, offset: [0, 0] };
    if (isMagnetic()) {
      currentEditor.reset();
      lab.ampere = null;
      lab.presetNote = '';
      if (lab.chips.ampere) plane.placeAmpere();
    } else if (lab.scene === 'playground') {
      editor.reset();
      project.resetCarried(); // a reset world must not save the comparison / vector mode / legend of the file opened before it
      lab.gauss = null;
      if (lab.chips.gauss) plane.placeGauss();
    } else {
      stopPlayback();
      s.models[lab.scene] = structuredClone(DEFAULT_SCENES[lab.scene]);
      store.setScene(lab.scene);
      scenesPanel.show(lab.scene);
      lab.error = '';
    }
    plane.invalidate();
    requestRender();
  }

  // The radius slider is an interaction like a drag: the precise flux waits until it is released (change / focusout).
  root.addEventListener('input', event => {
    if (event.target.id === 'em-time') { stopPlayback(); store.setTime(event.target.value); requestRender(); return; }
    if (event.target.id === AMPERE_SLIDER && lab.ampere) {
      interaction.begin('ampere-slider');
      const size = Number(event.target.value);
      lab.ampere = clampAmpere(lab.ampere.shape === 'rect'
        ? { ...lab.ampere, halfWidth: size, halfHeight: size * 0.7 } : { ...lab.ampere, radius: size }, lab.ampere);
      requestRender();
      return;
    }
    if (event.target.id === 'em-gauss-radius' && lab.gauss) {
      interaction.begin('gauss-slider');
      lab.gauss = { ...lab.gauss, radius: Number(event.target.value) };
      requestRender();
    }
  }, listen);
  const endSlider = event => {
    const token = event.target.id === AMPERE_SLIDER ? 'ampere-slider' : event.target.id === 'em-gauss-radius' ? 'gauss-slider' : null;
    if (!token || !interaction.end(token)) return;
    requestRender();
  };
  root.addEventListener('change', endSlider, listen);
  root.addEventListener('focusout', endSlider, listen);

  root.addEventListener('change', event => {
    if (event.target.id !== 'em-pg-plane') return;
    plane.cancel();
    getMode().setPlane(event.target.value);
    if (lab.gauss && lab.scene === 'playground') {
      const center = lab.gauss.center.slice();
      center[planeNormal(pg.plane)] = modes.sandbox.fixed();
      lab.gauss = { ...lab.gauss, center };
    }
    if (lab.ampere) {
      const center = lab.ampere.center.slice();
      center[planeNormal(pg.plane)] = modes.sandbox.fixed();
      lab.ampere = { ...lab.ampere, center };
    }
    requestRender();
  }, listen);

  // ---- lifecycle -------------------------------------------------------------------------------------------------

  function suspend() {
    diagnostics.suspends += 1;
    if (frameId !== null) { cancelAnimationFrame(frameId); frameId = null; }
    stopPlayback();
    plane.cancel();
    threeD.cancel();
    interaction.endAll();
  }
  function resume() { if (!destroyed && s.active && !document.hidden) requestRender(); }
  document.addEventListener('visibilitychange', () => (document.hidden ? suspend() : resume()), listen);
  window.addEventListener('blur', suspend, listen);
  window.addEventListener('focus', resume, listen);

  function switchCourse(value) {
    if (courseActive === value) return;
    courseActive = value;
    $('#em-course-root').hidden = !value;
    $('#em-lab').hidden = value;
    if (value) { suspend(); store.setActive(false); requestCourse(); }
    else { course?.deactivate(); store.setActive(true); resume(); }
  }
  function activateCourseIfNeeded() { if (!destroyed && courseActive && workspaceActive && course) course.activate(); }
  function showCourseStatus(failed) {
    courseStatus?.remove();
    const node = document.createElement('div');
    node.className = 'workspace-loading';
    node.setAttribute('role', failed ? 'alert' : 'status');
    const text = document.createElement('p');
    text.textContent = failed
      ? '전자기학 문제 풀이를 불러오지 못했습니다. 연결을 확인한 뒤 다시 시도하세요. 계속 실패하면 작업을 저장하고 페이지를 새로고침하세요.'
      : '불러오는 중…';
    node.append(text);
    if (failed) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = '다시 시도';
      retry.addEventListener('click', requestCourse);
      node.append(retry);
    }
    $('#em-course-root').prepend(node);
    courseStatus = node;
  }
  function requestCourse() {
    if (course) { activateCourseIfNeeded(); return; }
    if (coursePending) return;
    showCourseStatus(false);
    const pending = coursePending = loadEMCourseModule().then(module => {
      if (destroyed) return;
      courseStatus?.remove();
      courseStatus = null;
      course = module.createEMCourseController($('#em-course-root'), { onClose: () => switchCourse(false) });
      coursePending = null;
      activateCourseIfNeeded();
    }).catch(() => {
      if (coursePending === pending) coursePending = null;
      if (!destroyed) showCourseStatus(true);
    });
  }
  $('#em-course-open').addEventListener('pointerenter', prefetchEMCourse, listen);
  $('#em-course-open').addEventListener('focus', prefetchEMCourse, listen);

  const resizeWatcher = new ResizeObserver(() => { if (lab.tab === '3d') requestRender(); });
  resizeWatcher.observe($('#em-canvas'));
  events.signal.addEventListener('abort', () => resizeWatcher.disconnect(), { once: true });

  scenesPanel.show(null);
  return {
    activate() {
      workspaceActive = true;
      if (courseActive) { if (course) course.activate(); else requestCourse(); return; }
      store.setActive(true);
      render();
    },
    deactivate() {
      workspaceActive = false;
      course?.deactivate();
      suspend();
      store.setActive(false);
    },
    inspect() {
      return {
        ...store.inspect(), playground: editor.inspect(), playgroundActive: lab.scene === 'playground',
        reducedMotion: motion.matches, quality: lab.quality, tab: lab.tab, scene: lab.scene, chips: { ...lab.chips }, gauss: lab.gauss ? structuredClone(lab.gauss) : null,
        field: lab.field, current: structuredClone(cs), ampere: lab.ampere ? structuredClone(lab.ampere) : null,
        view: structuredClone(lab.view), courseActive, course: course ? course.inspect() : null,
        diagnostics: { ...diagnostics, plane: { ...plane.stats } },
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      course?.destroy();
      suspend();
      events.abort();
      palette.destroy();
      store.destroy();
      threeD.destroy();
      root.dataset.emDestroyed = 'true';
    },
  };
}
