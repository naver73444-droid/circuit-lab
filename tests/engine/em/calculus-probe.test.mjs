import test from 'node:test';
import assert from 'node:assert/strict';
import { CALCULUS_DEFAULTS, calculusLines, evaluateCalculus } from '../../../src/em-calculus.js';
import { EPS0 } from '../../../src/em-physics.js';
import { validatePointSources } from '../../../src/em-playground-physics.js';

const sources = validatePointSources([{ id: 'q1', q: 1e-9, position: [0.2, 0, 0] }]);
const run = (overrides = {}, probe = [0, 0, 0]) => evaluateCalculus({
  sources, probe, plane: 'xy', settings: { ...CALCULUS_DEFAULTS, ...overrides },
});

test('flux through a sphere around the charge is q/eps0 and the line shows converged text', () => {
  const result = run({ radius: 1 });
  assert.equal(result.ok, true);
  const { flux } = result.display;
  assert.ok(Math.abs(flux.flux - 1e-9 / EPS0) / (1e-9 / EPS0) < 0.01);
  const { lines } = calculusLines(result.display);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /∇·E = 0/);
  assert.match(lines[1], /^Φ\(R\) = 112\.\d V·m · 수렴/);
  assert.match(lines[2], /≈ 0|∮F·dl = /);
});

test('numeric differential mode reports div and curl with the h/2 refinement', () => {
  const { display } = run({ differentialMode: 'numeric' }, [1, 0.5, 0]);
  assert.ok(display.half);
  const { lines } = calculusLines(display);
  assert.match(lines[0], /^∇·F = .* · ∇×F = .* · h\/2와 Δ /);
});

test('rotational math field: curl 2*alpha and circulation 2*alpha*pi*R^2', () => {
  const { display } = evaluateCalculus({ sources: [], probe: [0, 0, 0], plane: 'xy', settings: { ...CALCULUS_DEFAULTS, mode: 'rotational', alpha: 1.5, radius: 0.5 } });
  assert.ok(Math.abs(display.differential.curl[2] - 3) < 1e-6);
  assert.ok(Math.abs(display.loop.circulation - 3 * Math.PI * 0.25) < 1e-6);
  assert.equal(display.grid.length, 25);
  assert.match(calculusLines(display).lines[2], /arb\.·m/);
});

test('invalid settings return a reason instead of a display', () => {
  assert.match(run({ h: 1 }).error, /h는/);
  assert.match(run({ radius: 9 }).error, /반지름/);
  assert.match(run({ normal: [0, 0, 0] }).error, /법선/);
  assert.match(run({ radius: 5 }, [18, 0, 0]).error, /±20/);
});

test('a sphere crossing a line charge is reported as unsupported in the flux line', () => {
  const lines = validatePointSources([{ id: 'f', type: 'finite-line', lambda: 1e-9, start: [0, -1, 0], end: [0, 1, 0] }]);
  const result = evaluateCalculus({ sources: lines, probe: [0, 0, 0], plane: 'xy', settings: { ...CALCULUS_DEFAULTS, radius: 0.5 } });
  assert.equal(result.ok, true);
  assert.match(calculusLines(result.display).lines[1], /^Φ\(R\): /);
});
