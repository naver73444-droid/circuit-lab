// Lesson 6 view: the sampled cosine and its alias (top), the replicated spectrum with the Nyquist band and
// the overlap region (bottom).
import { createLegend, createPane, createSurface } from './signals-plot.js';
import { clamp, formatNumber, niceTicks, sampleCurve } from './signals-util.js';
import { SAMPLING_AXIS, samplingFrame } from './signals-sampling-model.js';

export function createSamplingView({ doc, parent }) {
  const root = doc.createElement('div');
  parent.append(root);
  const surface = createSurface(doc, root, { label: '표본화 그래프 (시간 파형, 복제 스펙트럼)' });
  const timePane = createPane(doc, surface.svg);
  const specPane = createPane(doc, surface.svg);
  createLegend(doc, root, [
    { cls: 'c1', text: '원 신호 cos(2πf₀t+φ) · 스펙트럼 ±f₀ (채운 점)' },
    { cls: 'c3 mk', text: '표본 x[n]' },
    { cls: 'c2 dash', text: '복원 곡선 · 기저대역의 alias (빈 점)' },
    { cls: 'c5 band', text: '겹침 구간 (fₛ<2f₀, 점선 테두리)' },
  ]);

  const signalLine = timePane.line('c1');
  const reconstruction = timePane.line('c2 dash');
  const sampleStems = timePane.stems('c3', { radius: 4 });
  const nyquist = specPane.band('cm');
  const overlapA = specPane.band('c5 strong rim');
  const overlapB = specPane.band('c5 strong rim');
  const originalLines = specPane.stems('c1', { radius: 4.5 });
  const aliasLines = specPane.stems('c2', { radius: 4.5, hollow: true });
  const imageLines = specPane.stems('cm faint', { radius: 3 });
  const labelF0 = specPane.text('tint c1');
  const labelAlias = specPane.text('tint c2');
  const labelNyquist = specPane.text('muted');
  const labelOverlap = specPane.text('tint c5');

  function layout(width) {
    const compact = width < 640;
    const topH = compact ? 150 : 200;
    const botH = compact ? 120 : 140;
    surface.resize(width, 22 + topH + 40 + botH + 30);
    timePane.setBox(46, 22, width - 60, topH);
    specPane.setBox(46, 22 + topH + 40, width - 60, botH);
  }

  function update(state) {
    const { f0, fs, phi } = state.params;
    const frame = samplingFrame({ f0, fs, phi });
    // ---- time pane
    timePane.setDomain(0, frame.span, -1.3, 1.3);
    timePane.drawAxes({ xTicks: niceTicks(0, frame.span, 5), yTicks: [-1, 0, 1] });
    timePane.setTitle('시간 t [s]', 'start', true);
    const count = clamp(Math.ceil(f0 * frame.span * 28), 400, 1800);
    signalLine.set(sampleCurve(frame.signal, 0, frame.span, count));
    reconstruction.set(sampleCurve(frame.reconstruction, 0, frame.span, count));
    sampleStems.set(frame.samples.map((s) => [s.t, s.y]));
    // ---- spectrum pane
    const A = SAMPLING_AXIS;
    specPane.setDomain(-A, A, 0, 1.75);
    specPane.drawAxes({ xTicks: niceTicks(-A, A, Math.max(4, Math.floor(specPane.box.w / 90))), yTicks: [0] });
    specPane.setTitle('스펙트럼 f [Hz] — 표본화하면 k·fₛ마다 복제', 'start', true);
    nyquist.set(-fs / 2, fs / 2);
    if (frame.overlap) {
      overlapA.set(fs - f0, f0);
      overlapB.set(-f0, -(fs - f0));
    } else { overlapA.hide(); overlapB.hide(); }
    const original = frame.lines.filter((l) => l.original);
    const inBand = frame.lines.filter((l) => !l.original && l.inBand);
    const images = frame.lines.filter((l) => !l.original && !l.inBand);
    originalLines.set(original.map((l) => [l.f, 1]));
    aliasLines.set(inBand.map((l) => [l.f, 1]));
    imageLines.set(images.map((l) => [l.f, 1]));
    labelF0.setAt(f0, 1, `f₀ ${formatNumber(f0)}`, 'middle', -10);
    // The alias line sits at |f_alias|; for f_alias = 0 (f₀ a multiple of fₛ) both replicas merge on the vertical axis.
    const aliasLine = inBand.find((l) => l.f >= 0);
    if (aliasLine) {
      const dc = frame.alias.aliasHz === 0;
      labelAlias.setAt(aliasLine.f, 1, dc ? 'f_alias = 0 Hz (DC)' : `f_alias ${formatNumber(frame.alias.aliasHz)}`, 'middle', -26);
    } else labelAlias.hide();
    labelNyquist.setAt(0, 1.75, `Nyquist 대역 ±${formatNumber(fs / 2)} Hz`, 'middle', 13);
    if (frame.overlap) labelOverlap.setAt(fs / 2, 0.62, '겹침', 'middle');
    else labelOverlap.hide();
  }

  return { root, surface, layout, update, destroy: () => root.remove() };
}
