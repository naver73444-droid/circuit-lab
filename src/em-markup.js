// Learning-screen simplification for the EM workspace. The static markup lives in index.html, so this module
// reshapes it once (idempotent) instead of requiring a markup change: it works on both the old and the new markup.
// Elements keep their ids and event wiring; only grouping, labels and visibility change.
import { ensureCourseStyle } from './course-style.js';

const css = `
#em-workspace .em-mode-switch{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--line,#536478);border-radius:9px;min-height:42px;flex:0 0 auto}
#em-workspace .em-mode-switch button{border:0;border-radius:0;min-height:42px;font-weight:600}
#em-workspace .em-mode-switch button:first-child{border-radius:8px 0 0 8px}
#em-workspace .em-mode-switch button:last-child{border-radius:0 8px 8px 0}
#em-workspace .em-mode-switch button+button{border-left:1px solid var(--line,#536478)}
#em-workspace .em-mode-switch button[aria-pressed="true"]{background:var(--selection,#244d60);color:var(--accent,#9addf0)}
#em-workspace #em-pg-advanced{margin:0}
#em-workspace #em-pg-advanced>.em-pg-toolbar,#em-workspace #em-pg-advanced>.em-field-grid{margin:10px}
#em-workspace .em-results dt[hidden],#em-workspace .em-results dd[hidden]{display:none}
`;

const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };

/** Reshape the EM workspace markup. Safe to call more than once. */
export function simplifyEMMarkup(root) {
  if (!root || root.dataset.emSimplified === 'true') return;
  const doc = root.ownerDocument, $ = selector => root.querySelector(selector);
  ensureCourseStyle(root, 'em-learning', css);

  // Developer-facing unit/convention line beside the title.
  const header = $('.em-controls > div:first-child');
  for (const span of header ? [...header.querySelectorAll('span')] : []) if (/float64/i.test(span.textContent)) span.remove();

  // "문제 풀이" and "자유실험실" become one two-option switch.
  const lab = $('[data-em-scene="playground"]'), course = $('#em-course-open');
  if (lab && course && !lab.closest('.em-mode-switch')) {
    const group = doc.createElement('div');
    group.className = 'em-mode-switch'; group.setAttribute('role', 'group'); group.setAttribute('aria-label', '학습 방식');
    lab.before(group);
    group.append(lab, course);
    setText(lab, '자유실험실'); setText(course, '문제 풀이');
    lab.setAttribute('aria-pressed', 'true'); course.setAttribute('aria-pressed', 'false');
  }
  const presets = $('#em-model-presets > summary');
  setText(presets, '기본 모델 (점전하 · 쌍극자 · 전류 · 파동)');

  // Rarely used controls move behind one "고급" disclosure; the elements themselves are moved, not recreated.
  const tools = $('#em-stage-edit-tools');
  if (tools && !$('#em-pg-advanced')) {
    const advanced = doc.createElement('details'), summary = doc.createElement('summary');
    advanced.id = 'em-pg-advanced'; summary.textContent = '고급 · 이동 평면 · 표시 벡터 · 이동 전 비교';
    advanced.append(summary);
    const plane = $('#em-pg-plane')?.closest('.em-field-grid'), compare = $('#em-pg-compare')?.closest('.em-pg-toolbar');
    for (const part of [plane, compare]) if (part) advanced.append(part);
    tools.append(advanced);
  }

  // One legend line replaces the slice note + legend sentence + selected hint.
  const note = $('#em-slice-note');
  const legend = note?.nextElementSibling;
  if (legend && legend.matches('p.em-field-note')) legend.remove();

  // Result rows that only describe the implementation (revision, calculation method) are hidden; the integration
  // row is shown again only where it carries a real number (loop convergence).
  for (const id of ['#em-revision-value', '#em-integration-value']) {
    const value = $(id), label = value?.previousElementSibling;
    if (value) value.hidden = true;
    if (label?.tagName === 'DT') label.hidden = true;
  }
  setText($('#em-integration-value')?.previousElementSibling, '적분 수렴');

  setText($('.em-results > div:first-child > strong'), '측정값');
  // Names used only by the implementation.
  setText($('#em-calculus-settings > summary'), '고급 · 기울기 · 발산 · 회전');
  setText($('#em-calculus-settings legend'), '미분·적분 프로브');
  setText($('#em-project-settings legend'), '파일 · 학습 예제');
  setText($('#em-c-result'), '계산 전');
  setText($('#em-d-status'), '회로 파일과 별도로 저장 · 확정된 상태만 저장');
  root.dataset.emSimplified = 'true';
}

/** Show or hide the integration row (loop convergence). */
export function setIntegrationRow(root, text) {
  const value = root.querySelector('#em-integration-value');
  if (!value) return;
  value.textContent = text || '';
  value.hidden = !text;
  const label = value.previousElementSibling;
  if (label?.tagName === 'DT') label.hidden = !text;
}
