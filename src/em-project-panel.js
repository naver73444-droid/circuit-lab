// Save / open the sandbox as an EM file (separate from circuit files) and load a learning example.
import { makeExampleProject, parseEMProject, serializeEMProject } from './em-playground-project.js';

export function createProjectPanel({ root, editor, store, calculus, onLoaded, signal }) {
  const $ = selector => root.querySelector(selector), pg = editor.state;
  let generation = 0;
  const status = text => { $('#em-d-status').textContent = text; };

  const snapshot = () => ({
    format: 'circuit-lab-em-playground', version: 1,
    world: { sources: structuredClone(pg.sources), probe: [...pg.probe], plane: pg.plane, selectedId: pg.selectedId, comparison: null },
    view: { camera: { ...store.state.camera }, vectorMode: 'E' },
    calculus: calculus.settings(),
    legend: { mode: 'auto' },
  });

  function apply(project) {
    editor.replaceWorld(project.world);
    Object.assign(store.state.camera, project.view.camera);
    calculus.setSettings(project.calculus);
    onLoaded();
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
      status('불러왔습니다 · 되돌리기 기록은 비웠습니다.');
    } catch (error) {
      if (mine === generation) status(`열기 오류: ${error.message} · 현재 장면은 바뀌지 않았습니다.`);
    }
  }, { signal });

  $('#em-d-example').addEventListener('change', event => {
    const name = event.target.value;
    event.target.value = '';
    if (!name) return;
    try { apply(makeExampleProject(name, snapshot())); status('예제를 불러왔습니다.'); }
    catch (error) { status(`예제 오류: ${error.message}`); }
  }, { signal });
}
