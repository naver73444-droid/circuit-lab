// Sound-spectrum view: a start/stop bar, the two panes (wave, spectrum) drawn from signals-sound-model frames, and the
// k | f | 이론 | 측정 table. Sound runs only between "소리 켜기" and "소리 끄기"; leaving the lesson or the workspace, or
// hiding the page, calls suspend() (controller hook) and the sound stops. Before the first press nothing touches audio.
import { createPanesView } from './signals-panes-view.js';
import { createSoundEngine } from './signals-sound-audio.js';
import {
  MIC_ONLY, MICROPHONE, PLOT_HARMONICS, TABLE_HARMONICS, measureHarmonics, sineLevelDb, soundFrame, spectrumCurve, strongestPeak,
  theoryRows, waveWindow,
} from './signals-sound-model.js';
import { formatNumber } from './signals-util.js';

const MIC_ONLY_SPAN = 4000; // Hz shown for "마이크만"

export function createSoundView({ doc, parent }) {
  const win = doc.defaultView;
  const view = createPanesView({ doc, parent, label: '소리 스펙트럼 그래프 (파형, 스펙트럼)', maxPanes: 2 });
  const { root } = view;
  root.classList.add('sg-sound'); // phone CSS moves the start/stop bar under the plot so the plot starts on the first screen
  const engine = createSoundEngine(win);
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');

  const make = (tag, attrs = {}, parentNode = null, text) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    parentNode?.append(node);
    return node;
  };
  // Start/stop bar above the plot. Its pointerdown stays here so the controller's drag bubble never shows for a tap on it.
  const bar = make('div', { class: 'sg-sound-bar' });
  const button = make('button', { type: 'button', 'data-signals-sound-toggle': '', 'aria-pressed': 'false' }, bar, '소리 켜기');
  const status = make('p', { class: 'sg-sound-status', role: 'status', 'data-signals-sound-status': '' }, bar, '');
  root.prepend(bar);
  const tableBox = make('div', { class: 'sg-sound-table', 'data-signals-sound-table': '' }, root);
  const caption = make('p', { class: 'sg-sound-caption' }, tableBox, '');
  const table = make('table', {}, tableBox);
  const head = make('tr', {}, make('thead', {}, table));
  for (const name of ['k', 'f [Hz]', '이론', '측정']) make('th', { scope: 'col' }, head, name);
  const body = make('tbody', {}, table);
  const cells = Array.from({ length: TABLE_HARMONICS }, (_, i) => {
    const row = make('tr', { 'data-k': String(i + 1) }, body);
    make('th', { scope: 'row' }, row, String(i + 1));
    return { f: make('td', {}, row), theory: make('td', { 'data-theory-db': '' }, row), measured: make('td', { 'data-measured-db': '' }, row) };
  });
  for (const node of [bar, tableBox]) node.addEventListener('pointerdown', (event) => event.stopPropagation());

  let last = null;      // the lesson state of the latest update()
  let lastKey = '';     // what the sound depends on, to notice changes (the controller mutates params in place)
  let live = null;      // the latest captured frame data while sounding
  let measured = null;  // the latest harmonic rows (kept after stopping until something changes)
  let raf = 0;
  let ticks = 0;
  // Bumped by every start, restart, stop and suspend: a start or restart that is still waiting (the microphone prompt, the
  // fade of a restart) goes on only while its number is the current one; the engine lets go of anything that arrives later.
  let generation = 0;
  let pendingInput = null; // the input the waiting start asked for

  const config = (state) => ({ family: state.family, f0: state.params.f0, d: state.params.d ?? 0.25, gain: state.params.gain, input: state.params.input });
  const sounding = () => root.dataset.signalsSound === 'running' || root.dataset.signalsSound === 'starting';

  function setMode(mode, text) {
    root.dataset.signalsSound = mode;
    root.dataset.signalsSoundContext = engine.contextState;
    const on = mode === 'running' || mode === 'starting';
    button.textContent = on ? '소리 끄기' : '소리 켜기';
    button.setAttribute('aria-pressed', String(on));
    if (text !== undefined) status.textContent = text;
  }
  setMode('off', '소리 켜기를 누르면 테스트 음을 내고 스펙트럼을 잽니다. 처음에는 작은 소리로 시작합니다.');

  // A newer start, a stop or suspend() bumps the generation; the flow that bumped it owns the engine from then on, so a
  // stale flow only returns (the engine has already stopped whatever it received too late).
  async function start() {
    if (!last) return;
    const mine = ++generation;
    const current = () => mine === generation;
    const wanted = config(last);
    pendingInput = wanted.input;
    setMode('starting', '준비 중…');
    try {
      if (!(await engine.start(wanted, current)) || !current()) return;
      live = null;
      // the sliders may have moved while the microphone prompt was open
      if (engine.update(config(last))) { restart(); return; }
      setMode('running', last.params.input === MIC_ONLY ? '마이크를 듣는 중입니다.' : '재생 중입니다.');
      loop();
    } catch (error) {
      if (!current()) return;
      await engine.stop();
      if (current()) setMode('error', error.message);
    }
  }

  async function stop(text = '소리를 껐습니다. 표에는 마지막 측정이 남아 있습니다.') {
    generation += 1;
    if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
    if (sounding()) setMode('off', text);
    const fade = engine.stop(); // the microphone tracks stop right here; the tone fades out over 80 ms
    live = null;
    draw();
    await fade;
    root.dataset.signalsSoundContext = engine.contextState; // asleep now, unless a new start woke it again
  }

  // "소리 끄기" is shown while running and while starting (the microphone prompt may be open): both stop.
  button.addEventListener('click', () => { if (sounding()) stop(); else start(); });

  function loop() {
    if (raf) win.cancelAnimationFrame(raf);
    const tick = () => {
      raf = 0;
      if (!engine.running) return;
      ticks += 1;
      if (ticks % (reduced?.matches ? 15 : 3) === 0) sample(); // ~20 updates/s, ~4/s with reduced motion
      raf = win.requestAnimationFrame(tick);
    };
    raf = win.requestAnimationFrame(tick);
  }

  let spectrum = null;
  let wave = null;
  function sample() {
    const spec = { sampleRate: engine.sampleRate, fftSize: engine.fftSize };
    if (!spectrum || spectrum.length !== spec.fftSize / 2) { spectrum = new Float32Array(spec.fftSize / 2); wave = new Float32Array(spec.fftSize); }
    engine.readSpectrum(spectrum);
    engine.readWave(wave);
    const p = last.params;
    if (p.input === MIC_ONLY) {
      const peak = strongestPeak(spectrum, spec);
      const audible = peak && peak.db > -100;
      live = { curve: spectrumCurve(spectrum, spec, MIC_ONLY_SPAN, audible ? peak.db : -60), wave: waveWindow(wave, spec.sampleRate, audible ? peak.hz : 200), rows: [] };
      status.textContent = audible ? `가장 센 성분 ${formatNumber(peak.hz, 4)} Hz (진폭 ${formatNumber(sineLevelDb(peak.db), 3)} dBFS)` : '소리가 거의 들어오지 않습니다.';
      root.dataset.signalsSoundPeakHz = audible ? String(peak.hz) : '';
    } else {
      const m = measureHarmonics(spectrum, spec, p.f0, PLOT_HARMONICS);
      measured = m.rows;
      live = { curve: spectrumCurve(spectrum, spec, (PLOT_HARMONICS + 0.5) * p.f0, m.fundamental), wave: waveWindow(wave, spec.sampleRate, p.f0), rows: m.rows };
      const weak = !Number.isFinite(m.fundamental) || m.fundamental < m.floor + 12;
      // The fundamental as a sine amplitude (window-corrected); the noise floor only relative to it (noise would need another correction).
      status.textContent = weak && p.input === MICROPHONE
        ? '마이크에 테스트 음이 거의 안 들립니다: 이어폰을 빼고 스피커 음량을 올려 보세요.'
        : `재생 중 · 기본파 진폭 ${formatNumber(sineLevelDb(m.fundamental), 3)} dBFS · 잡음 바닥 기본파 대비 ${formatNumber(m.floor - m.fundamental, 3)} dB`;
    }
    draw();
  }

  function fillTable() {
    const p = last.params;
    tableBox.hidden = p.input === MIC_ONLY;
    if (tableBox.hidden) return;
    const theory = theoryRows(last.family, p.d ?? 0.25, TABLE_HARMONICS);
    caption.textContent = engine.running ? '측정은 실시간입니다 (기본파 = 0 dB).' : measured ? '측정 칸은 마지막으로 잰 값입니다.' : '소리를 켜면 측정 칸이 채워집니다.';
    cells.forEach((cell, i) => {
      const t = theory[i];
      const m = measured?.[i];
      cell.f.textContent = formatNumber(t.k * p.f0, 4);
      cell.theory.textContent = t.db === null ? '없음' : t.k === 1 ? '0 dB (기준)' : `${formatNumber(t.db, 3)} dB`;
      cell.theory.dataset.theoryDb = t.db === null ? 'none' : String(t.db);
      const text = !m || m.rel === null ? '—' : m.noisy ? '잡음 수준' : `${formatNumber(m.rel, 3)} dB`;
      cell.measured.textContent = text;
      cell.measured.dataset.measuredDb = !m || m.rel === null ? '' : m.noisy ? 'noise' : String(m.rel);
    });
  }

  function draw() {
    if (!last) return;
    view.update(soundFrame(last.family, last.params, engine.running ? live : null));
    fillTable();
    root.dataset.signalsSoundContext = engine.contextState;
  }

  // Another input while sounding: fade the old graph out, then start the new one — unless something else (소리 끄기,
  // leaving the lesson, another start) took over during the fade. Shown as "starting", so 소리 끄기 cancels it too.
  async function restart() {
    const mine = ++generation;
    if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
    pendingInput = last.params.input;
    setMode('starting', '입력이 바뀌어 다시 시작합니다.');
    const fade = engine.stop();
    live = null;
    draw();
    await fade;
    if (mine === generation) start();
  }

  return {
    ...view,
    update(state) {
      last = state;
      const key = JSON.stringify(config(state));
      if (key !== lastKey) {
        const first = !lastKey;
        lastKey = key;
        if (engine.running) {
          if (engine.update(config(state))) { restart(); return; }
          measured = null; // the old rows belong to the old tone; the next sample (≈50 ms) refills them
          if (live) live = { ...live, rows: [] };
        } else {
          if (!first) measured = null;
          // Another input while a start is still waiting (e.g. the microphone prompt is open): ask again for the new one.
          // The old request is given up; its tracks are stopped as soon as they arrive. Other changes are applied on arrival.
          if (root.dataset.signalsSound === 'starting' && state.params.input !== pendingInput) start();
        }
      }
      draw();
    },
    // Controller hook: the lesson, the workspace or the page went away. Always cancels a start or restart still waiting.
    suspend() {
      stop('다른 화면으로 옮겨 소리를 껐습니다.');
    },
    destroy() {
      generation += 1;
      if (raf) win.cancelAnimationFrame(raf);
      engine.close();
      view.destroy();
    },
  };
}
