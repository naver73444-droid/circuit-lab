// AC Thévenin equivalent and maximum average power transfer (ZL = ZTh*). RMS phasors; P = |I_rms|² R_L. Pure, no DOM.
import { add, multiply, divide, conjugate, magnitude, polar, cz } from './circuit-course-complex.js';

function passive(z, label) {
  if (!z || !Number.isFinite(z.re) || !Number.isFinite(z.im)) throw new RangeError(label + ': 유한한 복소수가 필요합니다.');
  if (z.re < 0) throw new RangeError(label + ': R은 0 이상이어야 합니다.');
  return z;
}

// "divider" two-port: Vs – Zs series – node with Zp to ground – Zo series to the load terminals.
// VTh = Vs Zp/(Zs+Zp), ZTh = Zo + Zs‖Zp (example 11.5).
export function dividerThevenin({ vs, zs, zp, zo }) {
  passive(zs, 'Zs'); passive(zp, 'Zp'); passive(zo, 'Zo');
  const sum = add(zs, zp);
  if (magnitude(sum) === 0) throw new RangeError('Zs+Zp=0 이라 테브냉 전압을 정할 수 없습니다.');
  const vth = multiply(vs, divide(zp, sum));
  const zpar = magnitude(zs) === 0 ? cz(0, 0) : divide(multiply(zs, zp), sum);
  return { vth, zth: add(zo, zpar) };
}

export function powerAt(vth, zth, zl) {
  const total = add(zth, zl);
  if (magnitude(total) === 0) return { I: cz(0, 0), pWatts: 0, singular: true };
  const I = divide(vth, total);
  return { I, pWatts: zl.re * magnitude(I) ** 2, singular: false };
}

export function maxPowerTransfer(p) {
  try {
    if (!Number.isFinite(p.vthRms) || p.vthRms < 0) throw new RangeError('VTh는 0 이상이어야 합니다.');
    let vth = polar(p.vthRms, p.vthDeg ?? 0), zth = p.source === 'divider' ? cz(0, 0) : passive(p.zth, 'ZTh'), derived = null;
    if (p.source === 'divider') {
      derived = dividerThevenin({ vs: vth, zs: p.zs, zp: p.zp, zo: p.zo });
      vth = derived.vth; zth = derived.zth;
    }
    if (zth.re <= 0) throw new RangeError('최대전력은 RTh>0 일 때만 유한합니다 (Pmax=|VTh|²/(4RTh) RMS).');
    const optimum = conjugate(zth), zl = p.zl ? passive(p.zl, 'ZL') : optimum; // no ZL given → the matched load
    const now = powerAt(vth, zth, zl), best = powerAt(vth, zth, optimum);
    const vm = magnitude(vth);
    const pmaxClosed = vm * vm / (4 * zth.re); // RMS form of |VTh,peak|²/(8 RTh)
    const eta = zl.re / (zth.re + zl.re);
    // Curves: P vs R_L (X_L fixed at the slider) and P vs X_L (R_L fixed at the slider), both drawn around the optimum.
    const rMax = Math.max(4 * zth.re, 2 * zl.re), xSpan = Math.max(2 * Math.abs(zth.im), 2 * Math.abs(zl.im), zth.re * 2);
    const curveR = Array.from({ length: 121 }, (_, n) => { const r = rMax * n / 120; return [r, powerAt(vth, zth, cz(r, zl.im)).pWatts]; });
    const curveX = Array.from({ length: 121 }, (_, n) => { const x = -xSpan + 2 * xSpan * n / 120; return [x, powerAt(vth, zth, cz(zl.re, x)).pWatts]; });
    return { status: 'valid', vth, zth, zl, derived, optimum, pNow: now.pWatts, iNow: now.I, pBest: best.pWatts, pmaxClosed, vthRms: vm,
      fraction: pmaxClosed === 0 ? null : now.pWatts / pmaxClosed, efficiency: eta, curveR, curveX,
      sourceS: multiply(vth, conjugate(now.I)), vload: multiply(now.I, zl),
      checks: [{ label: '최대전력 공식 |VTh|²/(4RTh) − P(ZL=ZTh*)', actual: Math.abs(best.pWatts - pmaxClosed), expected: 0, unit: 'W', tol: 1e-9 * (pmaxClosed + 1e-12) }]
        .map(c => ({ ...c, pass: c.actual <= c.tol })) };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}
