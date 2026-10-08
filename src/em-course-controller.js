// Problem-solving course (lazy module). One screen per experiment: the picture on the left, a live parameter strip, the
// current answer and collapsible solution sections on the right. Every control applies at once; time-dependent
// experiments get a scrubber and a play button that animate the picture through the experiment's own evaluate().
import { EXPERIMENTS, getExperiment, COURSE_ROADMAP } from './em-course-registry.js';
import { createCourseView, createRadialProfileView, drawTimeTrace } from './em-course-view.js';
import { inductionAfterStructural, inductionAfterNumeric, inductionNumericReason } from './course-illustration-contract.js';
import { renderSymbolic } from './course-symbolic-view.js';
import { siText, siVector } from './em-format.js';
import { createPalette, watchReducedMotion } from './em-palette.js';
import { coordinateScale, coordinateText, formatParam, isParamVisible, paramSpec, parseParam, topicOf, valueFromRange } from './em-course-params.js';
import { advanceTime, clampTime, instantProfiles, normalizeTime, timeSpec, timeTrace } from './em-course-time.js';
import { highlightSymbolic } from './em-course-symbolic.js';
import {
  SHELL, buildParameterStrip, renderChecks, renderRequested, renderStatics, renderValues, sectionize, statusLabel, syncParameterStrip, list,
} from './em-course-ui.js';

const TOPICS = [...new Set(EXPERIMENTS.map(d => topicOf(d.id)))];
// The Hayt Ch.8 (6주차) subjects come first in the subject select, the Electromagnetics 1 review subjects after them.
const CH8_TOPICS = ['자기력·토크', '자성체·경계', '자기회로', '에너지·인덕턴스'].filter(name => TOPICS.includes(name));
const FIRST_EXPERIMENT = 'force-lorentz';
const LAST_KEY = 'circuit-lab.em-course.last';
const rememberedId = () => { try { const id = localStorage.getItem(LAST_KEY); return id && getExperiment(id) ? id : ''; } catch { return ''; } };
const remember = id => { try { localStorage.setItem(LAST_KEY, id); } catch { /* storage may be blocked */ } };
const CHECK_DELAY = 300;
const MODEL_KIND = {
  'finite-integration': '유한 형상 · 적분 모델', 'boundary-solver': '경계값 수치해석',
  'lecture-closed-form': '강의 공식 · 닫힌 형태 모델', 'lecture-concept': '개념 모형 · 강의 설명용',
};
// Views that read the probe as a sweep coordinate (profile graph, parametric curve): no vector picker, no arrow grid.
const isSweepView = def => ['profile', 'xy-curve'].includes(def.view?.kind);
// The input a sweep graph's coordinate stands for (view.link: { param, when }) while its condition holds; null otherwise.
const linkOf = (def, params) => {
  const link = def.view?.link;
  return link && (!link.when || params[link.when.key] === link.when.equals) ? link.param : null;
};
const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });

// initial: what the tab memory stored (snapshot() of an earlier build), restored after checking; onChange: something the learner
// changed (the workspace then saves the tab memory a little later).
export function createEMCourseController(root, { onClose, initial = null, onChange = null } = {}) {
  const events = new AbortController(), listen = { signal: events.signal }, records = new Map();
  const $ = selector => root.querySelector(selector);
  let active = false, selectedId = rememberedId() || getExperiment(FIRST_EXPERIMENT)?.id || EXPERIMENTS[0]?.id;
  let playing = false, playFrame = null, lastTick = 0, checkTimer = null, renderFrame = null, noteHiddenAtFold = null;
  root.innerHTML = SHELL;
  // A theme change recolours every canvas of the screen: the picture and the emf(t) time graph under it.
  const palette = createPalette(root, () => { if (active) renderTime(definition(), record()); schedulePicture(); });
  // Nothing here starts playing by itself; if the user turns "reduce motion" on while a time experiment plays, it stops.
  const motion = watchReducedMotion(events.signal, () => { if (playing) { stopPlayback(); scheduleChecks(); } });
  const getPalette = () => palette.current();

  const definition = () => getExperiment(selectedId);
  const defaults = def => Object.fromEntries((def.parameters || []).map(item => [item.key, item.initial]));
  const evaluate = (def, params, point) => {
    try { return def.evaluate({ ...params }, [...point]); }
    catch (error) { return { status: 'invalid', reason: error.message, vectors: {}, scalars: [] }; }
  };
  const profiles = (def, params) => {
    if (typeof def.profile !== 'function') return [];
    const output = def.profile({ ...params }, 81);
    const finite = series => Array.isArray(series.points) && series.points.length <= 2048
      && series.points.every(p => Number.isFinite(p.coordinate) && Number.isFinite(p.value));
    if (!Array.isArray(output) || !output.every(finite)) throw new TypeError('유한한 profile 표본이 필요합니다.');
    return output;
  };
  const fittedViewScale = (def, params) => {
    if (def.id !== 'faraday-loop' || !(params.area > 0)) return 1;
    return Math.max(0.01, Math.min(100, 2.5 * Math.sqrt(params.area / Math.PI) / def.view.extent));
  };

  function record() {
    if (!records.has(selectedId)) {
      const def = definition(), params = defaults(def), link = linkOf(def, params);
      const point = link ? [0, 0, params[link]] : [...(def.probeDefault || [1, 0, 0])];
      const coaxLike = def.id.startsWith('coax-current') || def.view?.kind === 'azimuthal';
      records.set(selectedId, {
        params, point, result: evaluate(def, params, point), profiles: profiles(def, params),
        checks: [], checked: false, checkError: '', error: '', vectorKey: '', viewScale: fittedViewScale(def, params), viewScaleManual: false,
        requestedKey: '', requestedLabel: '', answerMode: 'numeric', illustrationMemory: undefined,
        symbolicOptions: Object.fromEntries((def.symbolicControls || []).map(c => [c.key, c.initial])), symbolic: null,
        display: { vectors: !coaxLike, lines: true, density: 6, normalized: true }, timeKey: null,
      });
    }
    return records.get(selectedId);
  }

  const view = createCourseView($('#em-course-canvas'), point => { if (active) probeTo(point); }, getPalette);
  /** A new observation point. Where the graph's coordinate is an input (view.link), the point moves that input instead. */
  function probeTo(point) {
    const def = definition(), data = record(), link = linkOf(def, data.params);
    if (link) {
      const parameter = def.parameters.find(p => p.key === link);
      const value = Math.min(parameter.max ?? Infinity, Math.max(parameter.min ?? -Infinity, point[2]));
      if (setParam(link, value)) syncParameterStrip($('#em-course-parameters'), def, data.params);
      return;
    }
    data.point = point;
    data.result = evaluate(def, data.params, point);
    renderNumeric();
  }
  const radialView = createRadialProfileView($('#em-course-radial-canvas'), radius => {
    if (!active) return;
    const data = record(), old = Math.hypot(data.point[0], data.point[1]), angle = old ? Math.atan2(data.point[1], data.point[0]) : 0;
    data.point = [radius * Math.cos(angle), radius * Math.sin(angle), data.point[2]];
    data.result = evaluate(definition(), data.params, data.point);
    renderNumeric();
  }, getPalette);

  // ---- symbolic side -----------------------------------------------------------------------------------------------

  function buildSymbolicControls() {
    const def = definition(), data = record(), host = $('#em-course-symbolic-controls');
    host.replaceChildren();
    for (const control of def.symbolicControls || []) {
      const label = document.createElement('label'), select = document.createElement('select');
      label.className = 'em-course-cond';
      label.append(document.createTextNode(control.label));
      select.dataset.emSymbolicControl = control.key;
      for (const choice of control.choices || []) select.append(option(String(choice.value), choice.label));
      select.value = String(data.symbolicOptions[control.key] ?? control.initial);
      label.append(select);
      host.append(label);
    }
  }

  function renderSymbolicSolution() {
    const def = definition(), data = record();
    try {
      data.symbolic = typeof def.symbolic === 'function' ? def.symbolic({ ...data.symbolicOptions })
        : { status: 'unsupported', title: def.title, reason: NOTE_NO_SYMBOLIC };
    } catch (error) {
      data.symbolic = { status: 'unsupported', title: def.title, reason: `기호 조건을 해석할 수 없습니다: ${error.message}` };
    }
    const box = $('#em-course-symbolic');
    renderSymbolic(box, data.symbolic);
    sectionize(box);
    data.symbolicKey = JSON.stringify(data.symbolicOptions);
    highlightSymbolic(root, def, data);
  }

  function syncSymbolicSelects() {
    const data = record();
    root.querySelectorAll('[data-em-symbolic-control]').forEach(select => {
      const value = data.symbolicOptions[select.dataset.emSymbolicControl];
      if (value !== undefined && select !== document.activeElement) select.value = String(value);
    });
  }

  // ---- numeric side ------------------------------------------------------------------------------------------------

  function pictureFlags(def, data) {
    const options = data.symbolicOptions;
    const unpicturedCoax = def.id.startsWith('coax-current') && options.innerMode === 1 && options.outerMode === 1;
    const unmappedParameterChoice = (def.symbolicControls || []).some(control => {
      const parameter = def.parameters.find(p => p.key === control.key), value = options[control.key];
      return parameter && typeof value === 'number' && (value < parameter.min || value > parameter.max);
    });
    const inductionReason = inductionNumericReason(def.id, options);
    const symbolicOnly = unpicturedCoax || unmappedParameterChoice || Boolean(inductionReason);
    return { unpicturedCoax, unmappedParameterChoice, inductionReason, symbolicOnly };
  }

  const NOTE_COAX_UNPICTURED = '표면 내부 전류 + 두꺼운 외부 귀환의 기호해는 풀이에 있습니다. '
    + '이 조합의 수치 장 모델은 연결되지 않아 그림을 흐리게 표시합니다.';
  const NOTE_NO_SYMBOLIC = '이 모델의 기호 풀이 연결을 준비 중입니다. 수치 예시는 숫자 답에서 확인할 수 있습니다.';
  const NOTE_SYMBOLIC_ONLY = '이 구조 조건은 기호 풀이만 표시합니다. 일치하는 수치 모델이 연결되지 않았습니다.';
  const NOTE_UNMAPPED = '선택한 기호 특수 조건은 문자식으로 풉니다. '
    + '일치하는 수치 모델이 연결되지 않아 그림과 수치 답을 흐리게 표시합니다.';

  // Structural choices that have no numeric parameter: the picture is only an example of the numeric inputs.
  function separateConditions(def, data) {
    const choiceLabel = c => c.choices.find(v => v.value === data.symbolicOptions[c.key])?.label || '';
    const separate = (def.symbolicControls || []).filter(c => !def.parameters.some(p => p.key === c.key)
      && data.symbolicOptions[c.key] !== c.initial
      && !(['wire-current', 'loop-axis'].includes(def.id) && c.key === 'direction'));
    const induction = ['faraday-loop', 'motional-rod'].includes(def.id);
    const relevant = separate.some(c => !induction || c.key === 'normalOrientation') || data.symbolic?.status === 'unsupported';
    if (!relevant) return '';
    const names = separate.map(c => `${c.label}: ${choiceLabel(c)}`).join(' · ');
    return ` 현재 기호 조건과 수치 그림은 별도입니다. ${names} — 그림은 수치 입력의 예시입니다.`;
  }

  function pictureNote(def, data, flags) {
    if (flags.inductionReason) return flags.inductionReason;
    if (flags.unpicturedCoax) return NOTE_COAX_UNPICTURED;
    if (flags.unmappedParameterChoice) return NOTE_UNMAPPED;
    const separate = separateConditions(def, data);
    if (!def.id.startsWith('coax-current')) return separate.trim();
    const ratio = value => Number(value.toPrecision(4)), { a, b, c } = data.params;
    const shape = `b/a=${ratio(b / a)}${c ? ` · c/a=${ratio(c / a)}` : ''}`;
    return `형상 예시: ${shape} · B₀=μI/(2πa). 정답은 문자식이며 이 비율은 시각화 예시입니다.${separate}`;
  }

  function gestureText(def) {
    const kind = def.view?.kind;
    if (def.id === 'faraday-loop') return '고정 루프입니다. 아래 시간을 끌거나 재생하면 B(t)와 기전력이 변합니다.';
    if (def.id === 'motional-rod') return '시간을 끌거나 재생하면 도선이 레일 위를 달립니다. 위치는 x₀+vt입니다.';
    if (kind === 'axis-only') return '축 위의 흰 점을 끌어 답을 확인하세요.';
    const axis = def.view?.coordinate, named = axis ? `${axis.label ? `${axis.label} ` : ''}${axis.key} — ` : '';
    if (kind === 'profile') return axis ? `${named}그래프를 끌거나 위 입력칸에 숫자로 입력하세요.` : '그래프를 끌어 관측 위치를 옮기세요.';
    if (kind === 'xy-curve') return axis ? `${named}그림을 가로로 끌거나 좌우 방향키·숫자 입력으로 옮기세요.` : '그림을 가로로 끌거나 좌우 방향키로 위상(관측 위치)을 옮기세요.';
    if (def.id.startsWith('coax-current')) return '흰 점을 끌거나 아래 반경을 조절하세요.';
    return '흰 점을 끌어 관측 위치를 바꾸세요.';
  }

  function currentTime(def, data) {
    const spec = timeSpec(def, data.params);
    return spec ? { spec, t: clampTime(spec, data.params[spec.key]) } : null;
  }

  function renderTime(def, data) {
    const box = $('#em-course-time'), clock = currentTime(def, data);
    box.hidden = !clock;
    if (!clock) { $('#em-course-trace').hidden = true; return null; }
    const { spec, t } = clock, slider = $('#em-course-time-slider'), play = $('#em-course-play');
    // A range that is empty (the rod already at the end of its rail) disables the scrubber and says why.
    if (spec.disabled && playing) stopPlayback();
    slider.disabled = play.disabled = Boolean(spec.disabled);
    slider.title = play.title = spec.disabled ? spec.reason : '';
    if (slider !== document.activeElement) slider.value = String(spec.max > spec.min ? Math.round((t - spec.min) / (spec.max - spec.min) * 1000) : 0);
    const clockText = `t = ${Number((t / spec.displayScale).toPrecision(4))} ${spec.unit}`;
    $('#em-course-time-text').textContent = spec.disabled ? `${clockText} · ${spec.reason}` : clockText;
    play.textContent = playing ? '정지' : '재생';
    const trace = timeTrace(def, data.params, spec), canvas = $('#em-course-trace');
    canvas.hidden = !trace;
    if (trace) drawTimeTrace(canvas, trace, t, getPalette(), 'ℰ(t)');
    return clock;
  }

  function renderPicture() {
    if (!active) return;
    const def = definition(), data = record(), clock = currentTime(def, data), flags = pictureFlags(def, data);
    const clockText = clock ? `t = ${Number((clock.t / clock.spec.displayScale).toPrecision(3))} ${clock.spec.unit}` : '';
    const coax = def.id.startsWith('coax-current');
    view.update({
      definition: def, params: data.params, point: data.point, result: data.result, vectorKey: data.vectorKey, viewScale: data.viewScale,
      profiles: data.profiles, display: data.display, timeText: clockText,
      answer: def.view?.answerPoint?.(data.params, data.result) ?? null, probeLabel: def.view?.probeLabel?.(data.params) ?? '',
      instantProfile: clock && def.view?.kind === 'profile' ? domain => instantProfiles(def, data.params, domain) : null,
    });
    $('#em-course-canvas-box').classList.toggle('symbolic-only', flags.symbolicOnly);
    $('#em-course-radial-canvas').hidden = !coax || flags.unpicturedCoax;
    if (!$('#em-course-radial-canvas').hidden) {
      radialView.update({
        definition: def, params: data.params, point: data.point, result: data.result, profiles: data.profiles,
        normalized: data.display.normalized,
      });
    }
  }
  const schedulePicture = () => { if (renderFrame === null) renderFrame = requestAnimationFrame(() => { renderFrame = null; renderPicture(); }); };

  function renderNumeric() {
    const def = definition(), data = record(), result = data.result || { status: 'invalid' };
    const flags = pictureFlags(def, data);
    $('#em-course-status').textContent = flags.symbolicOnly ? '수치 시현 미연결' : statusLabel[result.status] || result.status;
    $('#em-course-status').dataset.status = flags.symbolicOnly ? 'unsupported' : result.status;
    $('#em-course-picture-note').textContent = pictureNote(def, data, flags);
    $('#em-course-picture-note').hidden = !$('#em-course-picture-note').textContent;
    // Measure the fold again only when the note appears or goes (renderNumeric runs on every drag frame).
    if (noteHiddenAtFold !== $('#em-course-picture-note').hidden) syncDescriptionFold();
    const keys = Object.entries(result.vectors || {}).filter(([, v]) => Array.isArray(v) && v.every(Number.isFinite)).map(([key]) => key);
    const select = $('#em-course-vector'), choices = keys.length ? keys : [''];
    if ([...select.options].map(o => o.value).join() !== choices.join()) {
      select.replaceChildren(...choices.map(key => option(key, key || '벡터 없음')));
    }
    if (!choices.includes(data.vectorKey)) data.vectorKey = choices[0];
    select.value = data.vectorKey;
    $('#em-course-vector-pick').hidden = keys.length < 2 || isSweepView(def);
    $('#em-course-grid-chip').setAttribute('aria-pressed', String(data.display.vectors));
    $('#em-course-grid-chip').hidden = isSweepView(def) || def.view?.kind === 'axis-only';
    const numericText = $('#em-course-answer');
    // A lecture experiment opens on its headline number (r, L, NI ...) rather than on the field vector that only draws the picture.
    if (def.lecture && !def.answerKeys?.length && !data.requestedKey && result.scalars?.length) { data.requestedKey = `scalar:${result.scalars[0].key}`; data.requestedLabel = result.scalars[0].label; }
    renderRequested($('#em-course-requested'), numericText, data, result, def);
    if (flags.symbolicOnly) numericText.textContent = NOTE_SYMBOLIC_ONLY;
    const parameterText = (def.parameters || []).filter(p => p.key !== 'time' && isParamVisible(p, data.params)).map(p => {
      const spec = paramSpec(p);
      // An angle shown in degrees reads in degrees here too.
      return spec.kind === 'select' ? '' : `${spec.label}: ${spec.unit === '°' ? `${formatParam(spec, data.params[p.key])}°` : siText(data.params[p.key], p.unit)}`;
    }).filter(Boolean).join(' · ');
    const region = result.region ? ` · 영역 ${result.region}` : '';
    const coordinate = def.view?.coordinate; // lecture sweeps read point[2] as an angle, a distance, a field strength ...
    const where = coordinate ? `${coordinate.label || coordinate.key} ${coordinate.key} = ${coordinateText(coordinate, data.point[2])}` : `측정점 ${siVector(data.point, 'm')}`;
    $('#em-course-substitution').textContent = `${parameterText} · ${where}${region}`;
    renderValues($('#em-course-values'), result);
    const unresolved = (data.profiles || []).filter(p => p.sampling?.status === 'unresolved')
      .map(p => p.sampling?.reason || p.notes?.join(' ') || '표본 해상도 제한: 이 곡선은 그리지 않습니다.');
    list($('#em-course-notes'), [...(result.notes || []), ...unresolved]);
    const coax = def.id.startsWith('coax-current'), radiusBox = $('#em-course-radius-control');
    radiusBox.hidden = !coax || flags.unpicturedCoax;
    if (coax) {
      const ratio = Math.hypot(data.point[0], data.point[1]) / data.params.a, slider = $('#em-course-radius');
      slider.max = String(Math.max(1, (data.params.c || data.params.b) / data.params.a * 1.5));
      if (slider !== document.activeElement) slider.value = String(ratio);
      $('#em-course-radius-value').textContent = `r/a = ${Number(ratio.toPrecision(3))}`;
    }
    renderSweep(def, data);
    const error = $('#em-course-error');
    error.hidden = !data.error;
    error.textContent = data.error;
    highlightSymbolic(root, def, data);
    renderTime(def, data);
    renderPicture();
  }

  // ---- sweep coordinate as a typed number ------------------------------------------------------------------------------

  const sweepAxis = def => (isSweepView(def) ? def.view?.coordinate : null);
  /** SI limits the typed coordinate may take: the parametric sweep, or the sampled profile's extent (null: no limit known). */
  function sweepLimits(def, data) {
    if (def.view?.kind === 'xy-curve') return def.view.curve?.sweep?.(data.params) ?? null;
    const points = data.profiles?.[0]?.points || [];
    return points.length ? [Math.min(...points.map(p => p.coordinate)), Math.max(...points.map(p => p.coordinate))] : null;
  }
  function renderSweep(def, data) {
    const axis = sweepAxis(def), box = $('#em-course-sweep');
    box.hidden = !axis;
    if (!axis) return;
    const { scale, unit } = coordinateScale(axis), input = $('#em-course-sweep-input');
    $('#em-course-sweep-label').textContent = `${axis.label ? `${axis.label} ` : ''}${axis.key} =`;
    $('#em-course-sweep-unit').textContent = unit === '1' ? '' : unit;
    input.setAttribute('aria-label', `${axis.label || axis.key} (${unit || '무차원'})`);
    if (input !== document.activeElement) {
      input.value = String(Number((data.point[2] / scale).toPrecision(5)));
      input.removeAttribute('aria-invalid');
      $('#em-course-sweep-error').hidden = true;
    }
  }
  $('#em-course-sweep-input').addEventListener('input', event => {
    const def = definition(), data = record(), axis = sweepAxis(def), input = event.target, error = $('#em-course-sweep-error');
    if (!axis) return;
    const raw = input.value.trim(), number = Number(raw), { scale } = coordinateScale(axis), limits = sweepLimits(def, data);
    const fail = text => { input.setAttribute('aria-invalid', 'true'); error.textContent = text; error.hidden = false; };
    if (!raw || !Number.isFinite(number)) { fail('유한한 숫자를 입력하세요.'); return; }
    const value = number * scale, slack = limits ? Math.abs(limits[1] - limits[0]) * 1e-9 : 0;
    if (limits && (value < limits[0] - slack || value > limits[1] + slack)) {
      fail(`${coordinateText(axis, limits[0])} … ${coordinateText(axis, limits[1])} 범위 밖입니다.`);
      return;
    }
    input.removeAttribute('aria-invalid');
    error.hidden = true;
    probeTo([0, 0, value]);
  }, listen);
  // leaving the field with an unusable value restores the current coordinate
  $('#em-course-sweep-input').addEventListener('change', () => { $('#em-course-sweep-input').blur(); renderNumeric(); }, listen);

  // ---- checks (automatic, after the last change) ---------------------------------------------------------------------

  function runChecks() {
    checkTimer = null;
    const def = definition(), data = record();
    data.checkError = '';
    if (pictureFlags(def, data).symbolicOnly) {
      data.checks = [];
      data.checked = false;
      renderChecks($('#em-course-checks'), $('#em-course-check-pill'), data);
      return;
    }
    try {
      data.checks = typeof def.verify === 'function' ? def.verify({ ...data.params }) : [];
      if (!Array.isArray(data.checks)) throw new TypeError('검증 결과 형식 오류');
      data.checked = true;
    } catch (error) { data.checks = []; data.checked = false; data.checkError = error.message; }
    renderChecks($('#em-course-checks'), $('#em-course-check-pill'), data);
  }
  function scheduleChecks() {
    const data = record();
    data.checked = false;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(runChecks, CHECK_DELAY);
  }

  // ---- changing parameters -------------------------------------------------------------------------------------------

  /** Apply one parameter. Returns false (and shows why) when the combination is not valid; the old value stays. */
  function setParam(key, value, { light = false } = {}) {
    // The clock's range depends on the other parameters (frequency, omega, rail geometry): bring the stored time into the
    // new range first, so the result, the curve and the cursor are all computed for the time that is displayed.
    const def = definition(), data = record(), params = normalizeTime(def, { ...data.params, [key]: value });
    // A linked graph coordinate follows its input (the magnetic circuit's 목표 B is the graph's B).
    const link = linkOf(def, params), point = link ? [0, 0, params[link]] : data.point;
    const result = evaluate(def, params, point);
    if (result.status === 'invalid') { data.error = result.reason || '모델 입력이 올바르지 않습니다.'; renderNumeric(); return false; }
    let nextProfiles;
    try { nextProfiles = profiles(def, params); } catch (error) { data.error = error.message; renderNumeric(); return false; }
    Object.assign(data, { params, result, profiles: nextProfiles, error: '', point });
    if (!data.viewScaleManual) data.viewScale = fittedViewScale(def, params);
    if (!light) {
      const sync = inductionAfterNumeric(def.id, params, data.symbolicOptions, data.illustrationMemory);
      data.symbolicOptions = sync.options;
      data.illustrationMemory = sync.memory;
      if (['wire-current', 'loop-axis'].includes(def.id)) data.symbolicOptions.direction = params.current < 0 ? 1 : 0;
      for (const control of def.symbolicControls || []) {
        if (control.choices.some(c => c.value === params[control.key])) data.symbolicOptions[control.key] = params[control.key];
      }
      if (JSON.stringify(data.symbolicOptions) !== data.symbolicKey) { renderSymbolicSolution(); syncSymbolicSelects(); }
      scheduleChecks();
    }
    renderNumeric();
    return true;
  }

  $('#em-course-parameters').addEventListener('input', event => {
    const target = event.target, def = definition(), data = record();
    const sliderKey = target.dataset.emCourseSlider, inputKey = target.dataset.emCourseParameter;
    if (sliderKey) {
      const spec = paramSpec(def.parameters.find(p => p.key === sliderKey));
      const value = valueFromRange(spec, Number(target.value) / 1000);
      if (setParam(sliderKey, value)) syncParameterStrip($('#em-course-parameters'), def, data.params);
      return;
    }
    if (!inputKey || target.tagName === 'SELECT') return;
    const spec = paramSpec(def.parameters.find(p => p.key === inputKey)), parsed = parseParam(spec, target.value);
    if (!parsed.ok) { target.setAttribute('aria-invalid', 'true'); data.error = parsed.error; renderNumeric(); return; }
    target.removeAttribute('aria-invalid');
    if (setParam(inputKey, parsed.value)) syncParameterStrip($('#em-course-parameters'), def, data.params);
  }, listen);
  $('#em-course-parameters').addEventListener('change', event => {
    const target = event.target, def = definition(), data = record(), key = target.dataset.emCourseParameter;
    if (!key) return;
    if (target.tagName === 'SELECT') {
      setParam(key, Number(target.value));
      syncParameterStrip($('#em-course-parameters'), def, data.params);
      return;
    }
    // leaving a field with an unusable value restores the last valid one
    target.removeAttribute('aria-invalid');
    data.error = '';
    syncParameterStrip($('#em-course-parameters'), def, data.params);
    renderNumeric();
  }, listen);

  $('#em-course-symbolic-controls').addEventListener('change', event => {
    const key = event.target.dataset.emSymbolicControl;
    if (!key) return;
    const def = definition(), data = record(), control = def.symbolicControls.find(c => c.key === key);
    const choice = control.choices.find(c => String(c.value) === event.target.value);
    if (!choice) return;
    data.symbolicOptions[key] = choice.value;
    if (['alignment', 'fieldRegime', 'motionRegime'].includes(key) && ['faraday-loop', 'motional-rod'].includes(def.id)) {
      const synced = inductionAfterStructural(def.id, data.params, data.symbolicOptions, key, data.illustrationMemory);
      data.params = normalizeTime(def, synced.params);
      data.illustrationMemory = synced.memory;
      data.result = evaluate(def, data.params, data.point);
      data.profiles = profiles(def, data.params);
    }
    // These current templates use a magnitude; keep the example's magnitude and align its sign with the chosen direction.
    if (['wire-current', 'loop-axis'].includes(def.id) && key === 'direction') {
      data.params = normalizeTime(def, { ...data.params, current: (choice.value === 1 ? -1 : 1) * Math.abs(data.params.current) });
      data.result = evaluate(def, data.params, data.point);
      data.profiles = profiles(def, data.params);
    }
    if (def.id.startsWith('coax-current')) {
      const options = { ...data.symbolicOptions };
      const targetId = options.innerMode === 1 && options.outerMode === 1 ? null
        : options.outerMode === 1 ? 'coax-current-thick' : options.innerMode === 1 ? 'coax-current-surface' : 'coax-current';
      if (targetId && targetId !== selectedId) { switchExperiment(targetId, { carryOptions: options, carryFrom: data }); return; }
    }
    const inRange = p => (p.min === undefined || choice.value >= p.min) && (p.max === undefined || choice.value <= p.max);
    const parameter = def.parameters.find(p => p.key === key && inRange(p));
    if (parameter && typeof choice.value === 'number') {
      data.params = normalizeTime(def, { ...data.params, [key]: choice.value });
      data.result = evaluate(def, data.params, data.point);
      data.profiles = profiles(def, data.params);
    }
    data.error = '';
    data.checked = false;
    renderSymbolicSolution();
    syncParameterStrip($('#em-course-parameters'), def, data.params);
    scheduleChecks();
    renderNumeric();
  }, listen);

  // ---- time ----------------------------------------------------------------------------------------------------------

  function setTime(t) {
    const def = definition(), clock = currentTime(def, record());
    if (!clock) return;
    setParam(clock.spec.key, clampTime(clock.spec, t), { light: true });
  }
  function stopPlayback() {
    playing = false;
    if (playFrame !== null) { cancelAnimationFrame(playFrame); playFrame = null; }
    $('#em-course-play').textContent = '재생';
  }
  function tick(now) {
    if (!active || document.hidden || !playing) { playFrame = null; return; }
    if (now - lastTick >= 1000 / 30) {
      const def = definition(), clock = currentTime(def, record());
      const dt = Math.min(0.1, (now - lastTick) / 1000 || 0);
      lastTick = now;
      if (clock) setTime(advanceTime(clock.spec, clock.t, dt));
    }
    playFrame = requestAnimationFrame(tick);
  }
  $('#em-course-play').addEventListener('click', () => {
    if (playing) { stopPlayback(); scheduleChecks(); return; }
    const clock = currentTime(definition(), record());
    if (!clock || clock.spec.disabled) return;
    playing = true;
    lastTick = performance.now();
    $('#em-course-play').textContent = '정지';
    playFrame = requestAnimationFrame(tick);
  }, listen);
  $('#em-course-time-slider').addEventListener('input', event => {
    stopPlayback();
    const clock = currentTime(definition(), record());
    if (clock) setTime(clock.spec.min + Number(event.target.value) / 1000 * (clock.spec.max - clock.spec.min));
  }, listen);
  $('#em-course-time-slider').addEventListener('change', scheduleChecks, listen);

  // ---- picture controls ------------------------------------------------------------------------------------------------

  $('#em-course-vector').addEventListener('change', () => { record().vectorKey = $('#em-course-vector').value; renderPicture(); }, listen);
  $('#em-course-grid-chip').addEventListener('click', () => {
    const data = record();
    data.display.vectors = !data.display.vectors;
    renderNumeric();
  }, listen);
  for (const [id, factor] of [['em-course-zoom-in', 0.75], ['em-course-zoom-out', 4 / 3], ['em-course-zoom-reset', null]]) {
    $(`#${id}`).addEventListener('click', () => {
      const data = record(), next = factor ? data.viewScale * factor : fittedViewScale(definition(), data.params);
      if (next >= 0.01 && next <= 100) { data.viewScale = next; data.viewScaleManual = Boolean(factor); renderPicture(); }
    }, listen);
  }
  $('#em-course-radius').addEventListener('input', event => {
    const data = record(), radius = Number(event.target.value) * data.params.a, old = Math.hypot(data.point[0], data.point[1]);
    const angle = old ? Math.atan2(data.point[1], data.point[0]) : 0;
    data.point = [radius * Math.cos(angle), radius * Math.sin(angle), data.point[2]];
    data.result = evaluate(definition(), data.params, data.point);
    renderNumeric();
  }, listen);
  $('#em-course-requested').addEventListener('change', () => {
    const data = record(), select = $('#em-course-requested');
    data.requestedKey = select.value;
    data.requestedLabel = select.selectedOptions[0]?.textContent || '';
    renderNumeric();
  }, listen);
  root.querySelectorAll('[data-em-answer-mode]').forEach(button => button.addEventListener('click', () => {
    record().answerMode = button.dataset.emAnswerMode;
    syncAnswerMode();
  }, listen));
  function syncAnswerMode() {
    const mode = record().answerMode;
    root.querySelectorAll('[data-em-answer-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.emAnswerMode === mode));
    });
    $('#em-course-answer-numeric').hidden = mode !== 'numeric';
    $('#em-course-answer-symbolic').hidden = mode !== 'symbolic';
  }

  // ---- experiment choice ---------------------------------------------------------------------------------------------

  function fillChoices() {
    const topic = $('#em-course-topic'), name = topicOf(selectedId);
    if (!topic.options.length) {
      const group = (label, names) => {
        const element = document.createElement('optgroup');
        element.label = label;
        element.append(...names.map(title => option(title, title)));
        return element;
      };
      const review = TOPICS.filter(title => !CH8_TOPICS.includes(title));
      topic.replaceChildren(...[CH8_TOPICS.length && group('Hayt Ch.8 (6주차)', CH8_TOPICS), review.length && group('전자기1 복습', review)].filter(Boolean));
    }
    topic.value = name;
    const select = $('#em-course-select');
    select.replaceChildren(...EXPERIMENTS.filter(d => topicOf(d.id) === name).map(def => option(def.id, def.title)));
    select.value = selectedId;
  }

  function buildDefinition() {
    stopPlayback();
    const def = definition(), data = record();
    fillChoices();
    $('#em-course-title').textContent = def.title;
    const sections = def.lecture?.sections?.length ? `Hayt §${def.lecture.sections.join(', ')} · ` : '';
    $('#em-course-kind').textContent = sections + (MODEL_KIND[def.modelKind] || '대칭·가정에 따른 해석 모델');
    $('#em-course-desc').textContent = def.description || '';
    $('#em-course-desc').hidden = !def.description;
    $('#em-course-desc').dataset.expanded = 'false';
    syncDescriptionFold();
    $('#em-course-gesture').textContent = gestureText(def);
    // A structural choice that is also a choice parameter is shown once, as the structural select.
    const isChoice = key => def.parameters.some(p => p.key === key && paramSpec(p).kind === 'select');
    const shared = new Set((def.symbolicControls || []).filter(c => isChoice(c.key)).map(c => c.key));
    const hidden = new Set([...shared, ...(timeSpec(def, data.params) ? ['time'] : [])]);
    buildParameterStrip($('#em-course-parameters'), def, data.params, hidden);
    $('#em-course-params-card').classList.toggle('no-strip', !$('#em-course-parameters').childElementCount);
    buildSymbolicControls();
    renderStatics(root, def, COURSE_ROADMAP);
    renderSymbolicSolution();
    syncAnswerMode();
    renderChecks($('#em-course-checks'), $('#em-course-check-pill'), data);
    renderNumeric();
    scheduleChecks();
  }

  function switchExperiment(id, { carryOptions = null, carryFrom = null } = {}) {
    if (!getExperiment(id)) return;
    const previous = carryFrom ? { params: { ...carryFrom.params }, point: [...carryFrom.point] } : null;
    selectedId = id;
    remember(id);
    if (carryOptions && previous) {
      const target = record(), next = definition();
      target.symbolicOptions = carryOptions;
      const carried = next.parameters.filter(p => previous.params[p.key] !== undefined).map(p => [p.key, previous.params[p.key]]);
      target.params = normalizeTime(next, { ...target.params, ...Object.fromEntries(carried) });
      target.point = previous.point;
      target.result = evaluate(next, target.params, target.point);
      target.profiles = profiles(next, target.params);
      target.checked = false;
      target.checks = [];
    }
    buildDefinition();
  }

  // Phones fold the description to its first line (styles.css) so the picture fits the first screen; "더 보기" unfolds it.
  // The button shows only while the folded text is really cut (or unfolded); a resize of the text measures again.
  // The picture note (shape example, why a picture is missing) folds with it.
  function syncDescriptionFold() {
    const desc = $('#em-course-desc'), more = $('#em-course-desc-more'), expanded = desc.dataset.expanded === 'true';
    const note = !$('#em-course-picture-note').hidden;
    noteHiddenAtFold = !note;
    const cut = expanded || note || (!desc.hidden && desc.scrollHeight > desc.clientHeight + 1);
    $('#em-course-picture-note').classList.toggle('em-folded', !expanded);
    more.hidden = !cut;
    more.textContent = expanded ? '접기' : '더 보기';
    more.setAttribute('aria-expanded', String(expanded));
  }
  $('#em-course-desc-more').addEventListener('click', () => {
    const desc = $('#em-course-desc');
    desc.dataset.expanded = String(desc.dataset.expanded !== 'true');
    syncDescriptionFold();
  }, listen);
  const descWatcher = new ResizeObserver(syncDescriptionFold);
  descWatcher.observe($('#em-course-desc'));
  events.signal.addEventListener('abort', () => descWatcher.disconnect(), { once: true });

  $('#em-course-select').addEventListener('change', () => {
    if ($('#em-course-select').value) switchExperiment($('#em-course-select').value);
  }, listen);
  $('#em-course-topic').addEventListener('change', () => {
    const first = EXPERIMENTS.find(d => topicOf(d.id) === $('#em-course-topic').value);
    if (first) switchExperiment(first.id);
  }, listen);
  $('#em-course-reset').addEventListener('click', () => { records.delete(selectedId); buildDefinition(); }, listen);
  $('#em-course-back').addEventListener('click', () => { onClose?.(); root.ownerDocument.getElementById('em-course-open')?.focus(); }, listen);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); }, listen);
  const traceWatcher = new ResizeObserver(() => { if (active) renderTime(definition(), record()); });
  traceWatcher.observe($('#em-course-trace'));
  events.signal.addEventListener('abort', () => traceWatcher.disconnect(), { once: true });

  // ---- tab memory -----------------------------------------------------------------------------------------------------
  // Per experiment: its inputs, the observation point, the structural (symbolic) choices and which answer is shown. A stored
  // record is used only when the experiment still evaluates with it; a value out of a parameter's range or an unknown choice
  // drops that record (the experiment opens on its defaults).
  const KEPT = ['params', 'point', 'symbolicOptions', 'answerMode', 'requestedKey', 'requestedLabel', 'vectorKey', 'display', 'viewScale', 'viewScaleManual'];
  function snapshot() {
    const stored = {};
    for (const [id, data] of records) stored[id] = Object.fromEntries(KEPT.map(key => [key, data[key]]));
    return { version: 1, selectedId, records: stored };
  }
  function restoreRecord(id, raw) {
    const def = getExperiment(id);
    if (!def || !raw || typeof raw !== 'object') return;
    const params = defaults(def);
    for (const parameter of def.parameters || []) {
      const value = raw.params?.[parameter.key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      if ((parameter.min !== undefined && value < parameter.min) || (parameter.max !== undefined && value > parameter.max)) return;
      params[parameter.key] = value;
    }
    const point = Array.isArray(raw.point) && raw.point.length === 3 && raw.point.every(Number.isFinite) ? [...raw.point] : null;
    const saved = selectedId;
    selectedId = id; // record() builds the defaults of the current experiment
    try {
      const data = record(), next = normalizeTime(def, params), result = evaluate(def, next, point ?? data.point);
      if (result.status === 'invalid') { records.delete(id); return; }
      Object.assign(data, { params: next, result, profiles: profiles(def, next), viewScale: fittedViewScale(def, next) });
      if (point) data.point = point;
      for (const control of def.symbolicControls || []) {
        const value = raw.symbolicOptions?.[control.key];
        if (control.choices?.some(choice => choice.value === value)) data.symbolicOptions[control.key] = value;
      }
      if (['numeric', 'symbolic'].includes(raw.answerMode)) data.answerMode = raw.answerMode;
      if (typeof raw.requestedKey === 'string' && raw.requestedKey.length < 80) { data.requestedKey = raw.requestedKey; data.requestedLabel = String(raw.requestedLabel ?? '').slice(0, 120); }
      if (typeof raw.vectorKey === 'string' && raw.vectorKey.length < 40) data.vectorKey = raw.vectorKey;
      const display = raw.display && typeof raw.display === 'object' ? raw.display : {};
      for (const key of ['vectors', 'lines', 'normalized']) if (typeof display[key] === 'boolean') data.display[key] = display[key];
      if (Number.isFinite(display.density) && display.density >= 2 && display.density <= 16) data.display.density = display.density;
      if (raw.viewScaleManual === true && Number.isFinite(raw.viewScale) && raw.viewScale >= 0.01 && raw.viewScale <= 100) {
        data.viewScale = raw.viewScale; data.viewScaleManual = true;
      }
    } catch { records.delete(id); } finally { selectedId = saved; }
  }
  if (initial && initial.version === 1 && initial.records && typeof initial.records === 'object') {
    for (const id of Object.keys(initial.records)) restoreRecord(id, initial.records[id]);
    if (typeof initial.selectedId === 'string' && getExperiment(initial.selectedId)) selectedId = initial.selectedId;
  }
  // Any input, choice, button or drag on the course is a change worth remembering (the save itself is debounced).
  if (onChange) for (const type of ['input', 'change', 'click', 'pointerup', 'keyup']) root.addEventListener(type, () => onChange(), listen);

  buildDefinition();
  return {
    snapshot,
    activate() { active = true; view.activate(); radialView.activate(); renderNumeric(); },
    deactivate() { active = false; stopPlayback(); view.deactivate(); radialView.deactivate(); },
    inspect() {
      return structuredClone({
        active, selectedId, playing, reducedMotion: motion.matches, records: Object.fromEntries(records), view: view.inspect(), radialView: radialView.inspect(),
      });
    },
    destroy() {
      events.abort();
      clearTimeout(checkTimer);
      stopPlayback();
      if (renderFrame !== null) cancelAnimationFrame(renderFrame);
      palette.destroy();
      view.destroy();
      radialView.destroy();
      active = false;
    },
  };
}
