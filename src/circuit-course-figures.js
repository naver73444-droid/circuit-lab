// Small SVG schematics for the course tools (strings only, no DOM). Colors are theme tokens through style attributes; meaning is also in the text.
const WIRE = 'style="stroke:var(--symbol)" stroke-width="3" fill="none"';
const FILL = 'style="fill:var(--raised);stroke:var(--symbol)"';
const text = (x, y, s, size = 16, anchor = 'start') => '<text x="' + x + '" y="' + y + '" font-size="' + size + '" text-anchor="' + anchor + '">' + s + '</text>';
const dot = (x, y) => '<circle cx="' + x + '" cy="' + y + '" r="5" style="fill:var(--accent)"/>';
const box = (x, y, w, h, label) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" ' + FILL + '/>' + text(x + w / 2, y + h / 2 + 6, label, 16, 'middle');
// A vertical coil of n bumps starting at (x, y), humps pointing right.
const coil = (x, y, bumps = 4, h = 28) => '<path d="M' + x + ' ' + y + Array.from({ length: bumps }, () => ' c 16 0 16 ' + h + ' 0 ' + h).join('') + '" ' + WIRE + '/>';
const arrow = (x, y, dir, label) => '<path d="M' + x + ' ' + y + ' l ' + (dir * 22) + ' 0 m ' + (-dir * 9) + ' -6 l ' + (dir * 9) + ' 6 l ' + (-dir * 9) + ' 6" ' + WIRE + ' stroke-width="2"/>' + text(x + dir * 11, y - 8, label, 14,
  'middle');
const svg = (label, body, h = 230) => '<svg class="circuit-course-schematic" viewBox="0 0 520 ' + h + '" role="img" aria-label="' + label + '">' + body + '</svg>';

function threePhase(f) {
  const ys = [45, 105, 165], names = ['a', 'b', 'c'], loadNames = ['A', 'B', 'C'];
  let body = ys.map((y, i) => '<path d="M80 ' + y + 'H' + (f.hasLine ? '190 M260 ' + y + 'H' : '') + '448" ' + WIRE + '/>' + text(98, y - 8, names[i], 18, 'middle') + text(430, y - 8, loadNames[i], 18, 'middle')
    + (f.hasLine ? box(190, y - 15, 70, 30, 'Zℓ') : '')).join('');
  body += box(14, 40, 66, 130, '전원') + text(47, 62, f.source === 'Y' ? 'Y' : 'Δ', 22, 'middle') + box(448, 40, 66, 130, '부하') + text(481, 62, f.load === 'Y' ? 'Y' : 'Δ', 22, 'middle');
  if (f.neutral !== 'none' && f.load === 'Y') body += '<path d="M47 170V205H481V170" ' + WIRE + ' stroke-dasharray="7 5"/>' + text(264, 198, f.neutral === 'ideal' ? 'N–n 중성선 (Zn=0)' : 'N–n 중성선 Zn', 14, 'middle');
  else body += text(264, 215, f.load === 'delta' ? 'Δ 부하: ZΔ=3ZY, Ia=IAB−ICA' : '3선식: Ia+Ib+Ic=0', 14, 'middle');
  return svg('3상 전원, 선로, 부하 결선 개념도', body);
}

function coupled(f) {
  const same = f.dots === 'same';
  const y0 = 70;
  let body = '<path d="M30 70V40H55 M111 40H120V' + y0 + ' M120 ' + (y0 + 112) + 'V190H30V120 M120 190H400V120" ' + WIRE + '/>';
  body += '<circle cx="30" cy="95" r="25" ' + FILL + '/>' + text(30, 100, '~ V', 15, 'middle') + box(55, 26, 56, 28, 'Z1') + box(372, 70, 56, 50, 'ZL');
  body += coil(120, y0) + coil(250, y0) + '<path d="M120 ' + y0 + 'H108 M250 ' + y0 + 'H275V40H400V70 M250 ' + (y0 + 112) + 'H275V190" ' + WIRE + '/>';
  body += dot(112, y0 + 4) + (same ? dot(242, y0 + 4) : dot(242, y0 + 108));
  body += text(185, 135, 'M', 22, 'middle') + text(95, 135, 'L1', 16, 'end') + text(285, 135, 'L2', 16);
  body += arrow(132, 40, 1, 'I1') + (f.i2Ref === 'loop' ? arrow(330, 190, -1, 'I2 (시계)') : arrow(350, 40, -1, 'I2 (들어옴)'));
  body += text(10, 225, '● = 점 단자 · ' + (same ? '점 같은 쪽: 메시 식에서 −jωM' : '점 반대쪽: 메시 식에서 +jωM'), 13);
  return svg('상호 결합된 두 코일과 점 위치', body);
}

function ideal(f) {
  const same = f.dots === 'same', y0 = 55;
  let body = '<path d="M30 70V40H150 M150 40V' + y0 + ' M150 ' + (y0 + 112) + 'V185H30V120 M270 ' + y0 + 'V40H400V80 M270 ' + (y0 + 112) + 'V185H400V130" ' + WIRE + '/>';
  body += '<circle cx="30" cy="95" r="25" ' + FILL + '/>' + text(30, 100, '~ V', 15, 'middle') + box(60, 22, 56, 28, 'Z1') + box(372, 80, 56, 50, 'ZL');
  body += coil(150, y0) + '<path d="M185 ' + (y0 - 5) + 'V' + (y0 + 118) + ' M195 ' + (y0 - 5) + 'V' + (y0 + 118) + '" ' + WIRE + ' stroke-width="2"/>' + coil(270, y0).replace(/ c 16 0 16 28 0 28/g, ' c -16 0 -16 28 0 28');
  body += dot(142, y0 + 4) + (same ? dot(278, y0 + 4) : dot(278, y0 + 108)) + text(190, 190, '1 : n', 16, 'middle') + text(340, 112, 'V2', 16);
  body += arrow(185, 36, 1, 'I1') + (f.i2Direction === 'out' ? arrow(300, 36, 1, 'I2 (부하로)') : arrow(335, 36, -1, 'I2 (들어옴)'));
  body += text(10, 222, same ? '점 같은 쪽 · V2/V1=+n' : '점 반대쪽 · V2/V1=−n', 14) + text(260, 222, 'I2/I1=' + ((f.dots === 'same') === (f.i2Direction === 'out') ? '+' : '−') + '1/n', 14);
  return svg('이상 변압기, 점 위치와 전류 방향', body);
}

// A terminal pair: two open circles joined by a dashed bracket that stands for the voltage across them.
const terminals = (x, y1, y2) => '<path d="M' + x + ' ' + y1 + 'V' + y2 + '" style="stroke:var(--muted)" stroke-width="2" stroke-dasharray="5 4" fill="none"/>'
  + [y1, y2].map(y => '<circle cx="' + x + '" cy="' + y + '" r="6" ' + FILL + '/>').join('');
// Coil taps: top (y 30) – N1 – middle (y 108) – N2 – bottom (y 186). Step-down: source over N1+N2, load over N2. Step-up: source over N1 only, load over N1+N2.
function auto(f) {
  const down = f.mode === 'down';
  let body = coil(250, 30, 6, 26) + '<path d="M250 30H200 M250 108H200 M250 186H200" ' + WIRE + '/>';
  body += down ? '<path d="M200 30H110 M200 186H110 M250 108H390 M250 186H390" ' + WIRE + '/>' + terminals(110, 30, 186) + terminals(390, 108, 186)
    : '<path d="M200 30H110 M200 108H110 M250 30H390 M250 186H390" ' + WIRE + '/>' + terminals(110, 30, 108) + terminals(390, 30, 186);
  body += down ? text(98, 112, '입력 V1 (N1+N2)', 15, 'end') + text(402, 152, '출력 V2 (N2)', 15) : text(98, 72, '입력 V1 (N1)', 15, 'end') + text(402, 112, '출력 V2 (N1+N2)', 15);
  body += text(262, 75, 'N1', 15) + text(262, 150, 'N2', 15) + text(10, 220, '단권: 1·2차가 한 코일 · 전기적으로 연결(절연 안 됨)', 14);
  return svg('단권변압기 ' + (down ? '강압' : '승압') + ' 결선: 입력 단자쌍과 출력 단자쌍', body);
}

function bank(f) {
  let body = '', sym = k => (k === 'Y' ? 'Y' : 'Δ');
  for (let i = 0; i < 3; i++) {
    const y = 30 + i * 62;
    body += coil(190, y, 2, 20) + coil(300, y, 2, 20) + '<path d="M165 ' + (y + 6) + 'V' + (y + 34) + ' M175 ' + (y + 6) + 'V' + (y + 34) + '" ' + WIRE + ' stroke-width="2"/>';
    body += text(60, y + 28, ['a', 'b', 'c'][i] + ' 상', 15, 'middle') + text(430, y + 28, ['A', 'B', 'C'][i] + ' 상', 15, 'middle');
  }
  body += text(130, 214, '1차 ' + sym(f.primary) + ' 결선', 16, 'middle') + text(360, 214, '2차 ' + sym(f.secondary) + ' 결선', 16, 'middle');
  return svg('3상 변압기 ' + sym(f.primary) + '-' + sym(f.secondary) + ' 결선', body);
}

const KINDS = { 'three-phase': threePhase, coupled, ideal, auto, bank };
export const toolFigure = figure => (figure && KINDS[figure.kind] ? KINDS[figure.kind](figure) : '');
