// Independent reference formulas for the signals tests (kept out of src: nothing in the app needs them).

// DTFT of the finite sequence x starting at index `start`: sum x[k] e^{-j omega (start + k)}.
export function finiteDTFT(x, omega, start = 0) {
  return x.reduce(
    (sum, v, k) => ({ re: sum.re + v * Math.cos(omega * (start + k)), im: sum.im - v * Math.sin(omega * (start + k)) }),
    { re: 0, im: 0 },
  );
}

// Fourier transform (rad/s) of a rectangle of height A and width T centered at 0.
export function rectangleFT(A, T, omega) {
  const q = (omega * T) / 2;
  return A * T * (q === 0 ? 1 : Math.sin(q) / q);
}
