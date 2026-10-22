// Audio side of the sound-spectrum lesson (Web Audio + getUserMedia, no drawing). Nothing is created before start():
// the AudioContext is made on the learner's first press of "소리 켜기" (browsers only allow sound after a gesture).
//   loopback (0):  oscillator → gain → analyser, and gain → speakers (quiet)
//   microphone (1): oscillator → gain → speakers; microphone → analyser (never to the speakers: no feedback)
//   mic only (2):  microphone → analyser
// The microphone is asked for without echo cancellation, noise suppression or automatic gain: those would remove or
// reshape exactly the tone the lesson wants to measure.
import { harmonicLimit, pulseWaveCoefficients, LOOPBACK, MIC_ONLY } from './signals-sound-model.js';

export const FFT_SIZE = 16384;
const RAMP = 0.015; // s, gain time constant (no clicks)

export function audioSupport(win) {
  const Context = win.AudioContext || win.webkitAudioContext;
  return { audio: typeof Context === 'function', mic: typeof win.navigator?.mediaDevices?.getUserMedia === 'function', Context };
}

export function createSoundEngine(win) {
  const support = audioSupport(win);
  let ctx = null;
  let analyser = null;
  let osc = null;
  let gain = null;
  let stream = null;
  let source = null;
  let mode = null;
  let wave = null; // the oscillator's current waveform key, so a periodic wave is only rebuilt when it changes

  function applyWave(config) {
    const key = config.family === 'pulse' ? `pulse:${config.d}` : config.family;
    if (!osc || key === wave) return;
    if (config.family === 'pulse') {
      const count = Math.max(1, harmonicLimit(config.f0, ctx.sampleRate, 256));
      const { real, imag } = pulseWaveCoefficients(config.d, count);
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
    } else {
      osc.type = config.family;
    }
    wave = key;
  }

  function releaseNodes() {
    if (osc) { try { osc.stop(); } catch { /* already stopped */ } osc.disconnect(); osc = null; }
    gain?.disconnect(); gain = null;
    source?.disconnect(); source = null;
    if (stream) { for (const track of stream.getTracks()) track.stop(); stream = null; }
    wave = null;
    mode = null;
  }

  async function start(config) {
    if (!support.audio) throw new Error('이 브라우저는 Web Audio를 지원하지 않아 소리를 낼 수 없습니다.');
    if (config.input !== LOOPBACK && !support.mic) throw new Error('이 브라우저에서는 마이크를 쓸 수 없습니다. 입력을 루프백으로 바꿔 보세요.');
    releaseNodes();
    ctx ||= new support.Context();
    if (ctx.state !== 'running') await ctx.resume();
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.5;
      analyser.minDecibels = -120;
      analyser.maxDecibels = 0;
      // A silent path to the speakers keeps the analyser pulled in every browser (some only process nodes that reach
      // the destination); its gain is 0, so the microphone is never played back.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      analyser.connect(sink);
      sink.connect(ctx.destination);
    }
    if (config.input !== LOOPBACK) {
      try {
        stream = await win.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      } catch (error) {
        const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
        throw new Error(denied ? '마이크 권한이 없어 들을 수 없습니다. 브라우저에서 마이크를 허용하거나 루프백으로 보세요.' : `마이크를 열 수 없습니다 (${error?.name ?? '오류'}). 루프백으로 보세요.`);
      }
      source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
    }
    if (config.input !== MIC_ONLY) {
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      gain.gain.value = 0;
      osc.frequency.value = config.f0;
      applyWave(config);
      osc.connect(gain);
      gain.connect(ctx.destination);
      if (config.input === LOOPBACK) gain.connect(analyser);
      osc.start();
      gain.gain.setTargetAtTime(config.gain / 100, ctx.currentTime, RAMP);
    }
    mode = config.input;
  }

  // Slider changes while sounding: frequency, waveform and volume follow at once; another input mode needs a restart.
  function update(config) {
    if (!ctx || mode === null) return false;
    if (config.input !== mode) return true; // the caller restarts
    if (osc) {
      osc.frequency.setTargetAtTime(config.f0, ctx.currentTime, RAMP / 3);
      if (config.family === 'pulse') wave = null; // the pulse's harmonic count depends on f0 (Nyquist)
      applyWave(config);
      gain.gain.setTargetAtTime(config.gain / 100, ctx.currentTime, RAMP);
    }
    return false;
  }

  async function stop() {
    if (gain && ctx) gain.gain.setTargetAtTime(0, ctx.currentTime, RAMP);
    const nodes = { osc, gain, source, stream };
    osc = null; gain = null; source = null; stream = null; mode = null; wave = null;
    // let the ramp finish, then tear the graph down and let the device sleep
    await new Promise((done) => win.setTimeout(done, 80));
    if (nodes.osc) { try { nodes.osc.stop(); } catch { /* already stopped */ } nodes.osc.disconnect(); }
    nodes.gain?.disconnect();
    nodes.source?.disconnect();
    if (nodes.stream) for (const track of nodes.stream.getTracks()) track.stop();
    if (ctx && ctx.state === 'running' && mode === null) await ctx.suspend().catch(() => {});
  }

  return {
    support,
    get running() { return mode !== null; },
    get mode() { return mode; },
    get contextState() { return ctx ? ctx.state : 'none'; },
    get sampleRate() { return ctx?.sampleRate ?? 48000; },
    get fftSize() { return analyser?.fftSize ?? FFT_SIZE; },
    start,
    update,
    stop,
    readSpectrum(target) { analyser?.getFloatFrequencyData(target); return target; },
    readWave(target) { analyser?.getFloatTimeDomainData(target); return target; },
    async close() {
      releaseNodes();
      const old = ctx;
      ctx = null; analyser = null;
      if (old && old.state !== 'closed') await old.close().catch(() => {});
    },
  };
}
