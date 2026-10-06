// Save / open the sandbox as an EM file (separate from circuit files) and load a learning example.
import { EM_PROJECT_FORMAT, EM_PROJECT_VERSION, makeExampleProject, parseEMProject, serializeEMProject } from './em-playground-project.js';

// `magnetic` (optional) is the magnetic mode of the workspace: read() gives { field, sources, selectedId, ampere, chips } and
// write({ sources, selectedId, ampere, chips }) replaces it (clearing its undo history). Without it only the electric part is saved.
export function createProjectPanel({ root, editor, store, calculus, magnetic = null, onLoaded, signal }) {
  const $ = selector => root.querySelector(selector), pg = editor.state;
  let generation = 0;
  const status = text => { $('#em-d-status').textContent = text; };

  // Fields of a file that this workspace has no control for (the saved "before" comparison, the vector mode and the legend)
  // are kept as loaded and written back unchanged, so opening a file and saving it again loses nothing.
  const freshCarried = () => ({ comparison: null, vectorMode: 'E', legend: { mode: 'auto' } });
  let carried = freshCarried();

  const snapshot = () => {
    const { field = 'electric', ...mag } = magnetic?.read() ?? {};
    return {
      format: EM_PROJECT_FORMAT, version: EM_PROJECT_VERSION,
      world: {
        sources: structuredClone(pg.sources), probe: [...pg.probe], plane: pg.plane, selectedId: pg.selectedId,
        comparison: structuredClone(carried.comparison),
      },
      view: { camera: { ...store.state.camera }, vectorMode: carried.vectorMode },
      calculus: calculus.settings(),
      legend: structuredClone(carried.legend),
      field, magnetic: magnetic ? mag : undefined,
    };
  };

  // A file replaces the whole workspace: both modes' undo histories are cleared. A learning example is a charge set-up only,
  // so it leaves the magnetic mode (and its history) alone.
  function apply(project, { withMagnetic = true } = {}) {
    editor.replaceWorld(project.world);
    if (withMagnetic) magnetic?.write(project.magnetic);
    Object.assign(store.state.camera, project.view.camera);
    calculus.setSettings(project.calculus);
    carried = {
      comparison: structuredClone(project.world.comparison ?? null), vectorMode: project.view.vectorMode,
      legend: structuredClone(project.legend),
    };
    onLoaded(project);
  }

  $('#em-d-save').addEventListener('click', () => {
    try {
      const source = serializeEMProject(snapshot());
      const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'circuit-lab-em-playground.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      status(`저장했습니다 · ${new TextEncoder().encode(source).byteLength} bytes`);
    } catch (error) { status(`저장 오류: ${error.message}`); }
  }, { signal });

  $('#em-d-load').addEventListener('click', () => $('#em-d-file').click(), { signal });
  $('#em-d-file').addEventListener('change', async event => {
    const file = event.target.files?.[0], mine = ++generation;
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 1048576) throw new Error('파일은 UTF-8 1 MiB 이하여야 합니다.');
      const source = await file.text();
      if (mine !== generation) return;
      apply(parseEMProject(source));
      status('불러왔습니다 · 전기·자기 되돌리기 기록은 비웠습니다.');
    } catch (error) {
      if (mine === generation) status(`열기 오류: ${error.message} · 현재 장면은 바뀌지 않았습니다.`);
    }
  }, { signal });

  $('#em-d-example').addEventListener('change', event => {
    const name = event.target.value;
    event.target.value = '';
    if (!name) return;
    try { apply(makeExampleProject(name, snapshot()), { withMagnetic: false }); status('예제를 불러왔습니다.'); }
    catch (error) { status(`예제 오류: ${error.message}`); }
  }, { signal });

  return {
    /** 초기화: the fields that came from a loaded file go back to their defaults together with the world. */
    resetCarried() { carried = freshCarried(); },
    inspectCarried: () => structuredClone(carried),
  };
}
