import { phasorPolar, wrapPhaseDifference } from './phasor-format.js';

// ---- arithmetic (pure)
export function parsePracticeNumber(text) {
  const value = String(text).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error('실수·허수에 유효한 숫자를 입력하세요. 예: -2.5, 3e-3');
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > 1e150) throw new Error('연습 입력은 절댓값 1e150 이하의 유한한 숫자만 지원합니다.');
  if (n === 0 && /[1-9]/.test(value.split(/e/i)[0])) throw new Error('입력이 너무 작아 0으로 반올림됩니다. 지수를 조정하세요.');
  return n;
}
const finite = z => z && [z.re, z.im].every(Number.isFinite);
export function practiceOperations(a, b) {
  if (!finite(a) || !finite(b)) throw new Error('유한한 복소수 두 개가 필요합니다.');
  const scale = Math.max(Math.abs(b.re), Math.abs(b.im));
  const br = scale ? b.re/scale : 0, bi = scale ? b.im/scale : 0;
  const denominator = br*br + bi*bi;
  const quotient = scale ? { re: ((a.re/scale)*br+(a.im/scale)*bi)/denominator, im: ((a.im/scale)*br-(a.re/scale)*bi)/denominator } : null;
  return { A: a, B: b, 'A+B': {re:a.re+b.re,im:a.im+b.im}, 'A−B': {re:a.re-b.re,im:a.im-b.im},
    'A×B': {re:a.re*b.re-a.im*b.im,im:a.re*b.im+a.im*b.re}, 'A÷B': finite(quotient) ? quotient : null,
    divisionIssue: scale === 0 ? 'B=0으로 나눌 수 없습니다.' : !finite(quotient) ? '연산 결과가 표현 범위를 넘었습니다.' : null };
}
/** Polar magnitude is nonnegative; angle is in degrees, not radians. */
export function polarToRectangular(magnitude, angleDegrees) {
  if (![magnitude, angleDegrees].every(Number.isFinite) || magnitude < 0 || magnitude > 1e150) throw new Error('극형 크기는 0 이상 1e150 이하, 위상은 유한한 도 단위여야 합니다.');
  const radians = (angleDegrees % 360) * Math.PI / 180;
  return { re: magnitude * Math.cos(radians), im: magnitude * Math.sin(radians) };
}
export function relativePhase(a, b) {
  if (!finite(a) || !finite(b)) return null;
  const pa = phasorPolar(a), pb = phasorPolar(b);
  if (pa.angleDegrees === null || pb.angleDegrees === null) return null;
  return wrapPhaseDifference(pa.angleDegrees, pb.angleDegrees);
}

// ---- practice tab (DOM; touches only its own widgets, never circuit state)
const number = x => Number.isFinite(x) ? Number(x.toPrecision(6)).toString() : '표현 범위 초과';
/** Independent arithmetic practice; never reads or changes circuit state. */
export function initializePhasorPractice(doc = document) {
  const tabs = [doc.getElementById('phasor-circuit-tab'), doc.getElementById('phasor-practice-tab')];
  function select(index) {
    tabs.forEach((tab, i) => { tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1; doc.getElementById(tab.getAttribute('aria-controls')).hidden = i !== index; });
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(i));
    tab.addEventListener('keydown', e => {
      let next = null;
      if (['ArrowLeft','ArrowRight'].includes(e.key)) next = 1-i;
      if (e.key === 'Home') next = 0;
      if (e.key === 'End') next = 1;
      if (next !== null) { e.preventDefault(); select(next); tabs[next].focus(); }
    });
  });
  const form = doc.getElementById('phasor-practice-form'), result = doc.getElementById('practice-result');
  function calculate() {
    result.replaceChildren();
    try {
      const read = id => { const input = doc.getElementById(id); try { const x = parsePracticeNumber(input.value); input.removeAttribute('aria-invalid'); return x; } catch (err) { input.setAttribute('aria-invalid','true'); throw err; } };
      const value = key => { const re = read(`practice-${key}-re`), im = read(`practice-${key}-im`); return doc.getElementById(`practice-${key}-mode`).value === 'polar' ? polarToRectangular(re, im) : {re, im}; };
      const values = practiceOperations(value('a'), value('b'));
      for (const [name, z] of Object.entries(values)) {
        if (name === 'divisionIssue') continue;
        const row = doc.createElement('div'), title = doc.createElement('strong'), text = doc.createElement('span');
        title.textContent = name;
        if (!z) text.textContent = values.divisionIssue;
        else { const polar = phasorPolar(z); text.textContent = `${number(z.re)} ${z.im < 0 ? '−' : '+'} j${number(Math.abs(z.im))} = ${number(polar.magnitude)} ∠ ${polar.angleDegrees === null ? '위상 미정 (크기 0)' : number(polar.angleDegrees)+'°'}`; }
        row.append(title, text); result.append(row);
      }
    } catch (err) { result.textContent = err.message; }
  }
  for (const key of ['a','b']) doc.getElementById(`practice-${key}-mode`).addEventListener('change', event => {
    const polar = event.target.value === 'polar';
    doc.getElementById(`practice-${key}-re-label`).textContent = polar ? '크기 (0 이상)' : '실수';
    doc.getElementById(`practice-${key}-im-label`).textContent = polar ? '위상 (°)' : '허수';
    result.textContent = '입력 형식이 바뀌었습니다. 새 형식에 맞춰 숫자를 입력하고 변환·연산을 누르세요.';
  });
  form.addEventListener('submit', e => { e.preventDefault(); calculate(); });
  calculate();
}
