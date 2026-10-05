import { phasorPolar } from './phasor-format.js';
import { parsePracticeNumber, practiceOperations, polarToRectangular } from './phasor-practice-model.js';
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
