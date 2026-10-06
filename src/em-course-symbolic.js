// Ties the symbolic solution to the numeric example: which region / boundary is active at the probe, and the one
// formula shown on the answer card. DOM only; the algebra comes from the experiment definition.
import { appendCourseMath } from './course-math-view.js';
import { inductionNumericReason } from './course-illustration-contract.js';

const BOUNDARY_REGIONS = ['inner-interface', 'inner-current-sheet', 'outer-current-sheet', 'outer-inner-interface', 'outer-interface'];
const isCoax = definition => definition.id.startsWith('coax-current');

function activeIndices(definition, data) {
  const region = data.result?.region, regions = data.symbolic?.regions || [];
  let index = (definition.symbolicAnswer?.pieces || []).findIndex(item => item.region === region);
  if (index < 0) index = regions.findIndex(item => item.region === region);
  const boundary = BOUNDARY_REGIONS.includes(region);
  const radius = ['inner-interface', 'inner-current-sheet'].includes(region) ? 'a' : region === 'outer-interface' ? 'c' : 'b';
  const atAxis = isCoax(definition) && Math.hypot(data.point[0], data.point[1]) === 0;
  const boundaries = data.symbolic?.boundaries || [], matches = text => condition => condition.replace(/\s/g, '') === text;
  const boundaryIndex = atAxis ? boundaries.findIndex(item => matches('r=0')(item.condition))
    : boundary ? boundaries.findIndex(item => matches(`r=${radius}`)(item.condition)) : -1;
  return { regionIndex: index, boundaryIndex, boundary, atAxis };
}

/** Mark the active branch inside the solution and fill the answer card's formula. */
export function highlightSymbolic(root, definition, data) {
  const box = root.querySelector('#em-course-symbolic'), answer = root.querySelector('#em-course-active-branch');
  const { regionIndex, boundaryIndex, boundary, atAxis } = activeIndices(definition, data);
  const mark = (selector, key, index) => box.querySelectorAll(selector).forEach(node => { node.dataset.active = String(Number(node.dataset[key]) === index); });
  mark('[data-symbolic-region-index]', 'symbolicRegionIndex', regionIndex);
  mark('[data-symbolic-boundary-index]', 'symbolicBoundaryIndex', boundaryIndex);
  if (isCoax(definition) && data.symbolicOptions.innerMode === 1 && data.symbolicOptions.outerMode === 1) {
    box.querySelectorAll('[data-active]').forEach(node => { node.dataset.active = 'false'; });
    answer.textContent = '이 조합은 기호 풀이만 제공합니다. 수치 관측점 연동은 표시하지 않습니다.';
    return;
  }
  const chosen = boundary || atAxis ? data.symbolic?.boundaries?.[boundaryIndex] : data.symbolic?.regions?.[regionIndex];
  const direction = data.result?.vectors?.B, zero = direction && direction.every(v => v === 0);
  if (data.symbolic?.status !== 'supported') { answer.textContent = data.symbolic?.reason || '이 조건의 답은 지원하지 않습니다.'; return; }
  answer.replaceChildren();
  const note = text => { const p = document.createElement('p'); p.textContent = text; answer.append(p); };
  if (chosen) {
    const parts = chosen.formula.split(';');
    const formulas = isCoax(definition) ? parts.map(t => t.trim()).filter(t => /^B/.test(t)) : parts.slice(0, 2);
    note(chosen.condition);
    appendCourseMath(answer, formulas.length ? formulas.join('\n') : chosen.formula);
    if (isCoax(definition)) {
      const sense = data.params.current < 0 ? 'I<0: −φ · 시계' : 'I>0: +φ · 반시계';
      note(zero ? '방향 없음 (B=0)' : boundary ? '표면의 안쪽·바깥쪽 극한' : sense);
    }
  } else {
    const answers = data.symbolic.answers || [];
    const primary = ['faraday-loop', 'motional-rod'].includes(definition.id) ? answers.filter(a => /^ΦB|^ℰ(?:\(|$)/.test(a.quantity)) : answers.slice(0, 2);
    for (const item of primary) { appendCourseMath(answer, item.formula); if (item.direction) note(item.direction); }
  }
  const reason = inductionNumericReason(definition.id, data.symbolicOptions);
  if (reason) note(reason);
  if (['wire-current', 'loop-axis'].includes(definition.id)) {
    if (data.params.current === 0 && zero) answer.textContent = 'I=0인 수치 예시: B=H=0\n방향 없음. 일반 문자식은 풀이 보기에서 확인하세요.';
    else {
      const negative = data.params.current < 0;
      const direction = definition.id === 'loop-axis' ? (negative ? '−z' : '+z') : (negative ? '−φ · 시계' : '+φ · 반시계');
      note(`수치 예시 I=${data.params.current} A: ${direction}`);
    }
  }
}
