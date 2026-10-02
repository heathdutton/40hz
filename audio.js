/* 40 Hz audio stimulus.
 *
 * The whole file implements one rule, which is what all the research converged on:
 *
 *     The carrier is free. The envelope is sacred.
 *
 * So the node graph keeps them physically separate. The carrier is a looping buffer that can be
 * anything (shaped noise, a music file, a reference stimulus). The envelope is a second looping
 * buffer wired into a GainNode's AudioParam. Changing the carrier never touches the envelope, and
 * the envelope is identical in both ears, always.
 *
 * Design decisions and where they came from:
 *
 *   Envelope     Fast attack, exponential decay, sub-50% duty. Steeper attacks yield larger
 *                responses, and increased off-time raises response SNR. Same result as the visual
 *                side, arrived at independently.
 *   Spectrum     Tilted about -5 dB/oct. Pink (-3) is balanced for perception, not for this: 40 Hz
 *                ASSR falls with carrier frequency (250 Hz gives ~3x what 4 kHz gives), so the
 *                effectiveness-optimal tilt is steeper than pink. Presbycusis argues the same way.
 *   Emphasis     A band around 200-500 Hz rather than a discrete 250 Hz tone. A single sine
 *                modulated at 40 Hz puts sidebands at +/-40 Hz, which at 250 Hz is wider than the
 *                ~52 Hz auditory filter, so they partially resolve and the envelope arrives
 *                muddied. Filtered clicks beat pure-tone carriers for exactly this reason.
 *   Stereo       Diotic below ~800 Hz, decorrelated above. Binaural processing and ASSR yield are
 *                both dominated by low frequencies; perceived spaciousness is driven by high
 *                frequency decorrelation. So the decorrelation lives entirely above the band that
 *                generates the response. Never antiphase: interaural envelope mismatch spills
 *                energy into harmonics and is treated in the literature as degradation.
 */

'use strict';

const GAMMA_HZ = 40;

/* Seeded, so a given settings hash always produces the same carrier. Useful when comparing runs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ spectrum */

// Amplitude per 1 Hz component. tiltDbOct is the power slope: 0 is white, 3 is pink, 5 is ours.
function spectralShape(o) {
  const exp = -o.tiltDbOct / 6.0206;          // dB/oct -> amplitude exponent
  const empSigma = 0.62;                      // octaves, covers roughly 200-500 Hz
  return f => {
    let a = Math.pow(f / 1000, exp);
    a /= Math.sqrt(1 + Math.pow(o.lowHz / f, 4));      // low skirt
    a /= Math.sqrt(1 + Math.pow(f / o.highHz, 4));     // high skirt
    const oct = Math.log2(f / o.empHz);
    a *= Math.pow(10, (o.empDb / 20) * Math.exp(-0.5 * (oct / empSigma) ** 2));
    return a;
  };
}

// Amplitude weight of the interaurally shared component. Interaural coherence is this squared.
function coherenceWeight(f0, f1) {
  return f => {
    if (f <= f0) return 1;
    if (f >= f1) return 0;
    return Math.cos(Math.PI * 0.5 * Math.log2(f / f0) / Math.log2(f1 / f0));
  };
}

/* ------------------------------------------------------------------- carrier */

/* Inverse FFT, in place, radix 2. Float32 is plenty for audio (~-120 dB of rounding over 21 stages) and halves the
 * memory of a 45 s buffer. Yields between stages so the page stays responsive while it builds.
 */
async function inverseFft(re, im, onStage) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {                       // bit-reversal permutation
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) { cos[k] = Math.cos(2 * Math.PI * k / n); sin[k] = Math.sin(2 * Math.PI * k / n); }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = start + k, b = a + half;
        const xr = re[b] * cos[t] - im[b] * sin[t], xi = re[b] * sin[t] + im[b] * cos[t];
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
    await onStage();
  }
}

/* Shaped noise, built as a spectrum and turned into sound with one inverse FFT. ~45 s long because ears pick out
 * repeated noise fast, and a short loop comes across as a pattern. Every bin finishes whole cycles in the buffer, so
 * the loop point has no click. Shared (diotic) energy comes back as mono and the decorrelated energy as a stereo pair,
 * so the drift can move the decorrelated part alone.
 */
const CARRIER_MIN_SEC = 40;

async function buildTunedCarrier(sr, o, onProgress) {
  const t0 = Date.now();
  let n = 1;
  while (n < CARRIER_MIN_SEC * sr) n *= 2;                    // 2^21 at 44.1 and 48 kHz
  const df = sr / n;                                          // bin spacing, ~0.02 Hz
  const shape = spectralShape(o);
  const coh = coherenceWeight(o.cohLoHz, o.cohHiHz);
  const rng = mulberry32(o.seed || 1);
  const kMin = Math.max(1, Math.round(Math.max(20, o.lowHz * 0.5) / df));
  const kMax = Math.min(n / 2 - 1, Math.round(Math.min(sr / 2 - 1, o.highHz) / df));

  // Two real signals ride one complex transform. With x = a + ib, a comes back in re and b in im, as long as each
  // spectrum is Hermitian. So mono + i*left goes in one pass and right in a second.
  const reA = new Float32Array(n), imA = new Float32Array(n);
  const reB = new Float32Array(n), imB = new Float32Array(n);
  const put = (re, im, k, ar, ai, br, bi) => {
    re[k] = ar - bi; im[k] = ai + br;
    re[n - k] = ar + bi; im[n - k] = br - ai;
  };
  const polar = amp => { const p = rng() * 2 * Math.PI; return [amp * Math.cos(p), amp * Math.sin(p)]; };
  let shared = 0;
  for (let k = kMin; k <= kMax; k++) {
    const f = k * df, a = shape(f), c = coh(f);
    const sd = Math.sqrt(Math.max(0, 1 - c * c));
    const [mr, mi] = c > 0.0005 ? polar(a * c) : [0, 0];
    const [lr, li] = sd > 0.0005 ? polar(a * sd) : [0, 0];
    const [rr, ri] = sd > 0.0005 ? polar(a * sd) : [0, 0];
    if (c > 0.0005) shared++;
    put(reA, imA, k, mr, mi, lr, li);
    put(reB, imB, k, rr, ri, 0, 0);
  }

  const stages = 2 * Math.log2(n);
  let done = 0;
  const tick = () => {
    if (onProgress) onProgress(++done / stages);
    return new Promise(r => setTimeout(r, 0));
  };
  await inverseFft(reA, imA, tick);
  await inverseFft(reB, imB, tick);
  const mono = reA, indL = imA, indR = reB;

  // Normalise the summed signal to a fixed peak. The envelope tops out at exactly 1.0, so the
  // product cannot clip and no separate product normalisation is needed.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(mono[i]) + Math.abs(indL[i]);
    const u = Math.abs(mono[i]) + Math.abs(indR[i]);
    if (v > peak) peak = v;
    if (u > peak) peak = u;
  }
  const g = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < n; i++) { mono[i] *= g; indL[i] *= g; indR[i] *= g; }
  return {
    mono, indL, indR,
    stats: { loopSec: n / sr, tones: kMax - kMin + 1, sharedBins: shared, ms: Date.now() - t0 },
  };
}

/* ----------------------------------------------------------------- envelope */

/* One second holds exactly 40 cycles at any sample rate, so the loop is periodic by construction.
 * Values run in [1 - depth, 1]: full depth reaches true silence between pulses, partial depth
 * leaves the carrier running underneath. The 40 Hz response tolerates reduced depth well, so
 * there is a lot of comfort available cheaply here.
 */
function buildEnvelope(sr, o) {
  const n = sr;
  const env = new Float32Array(n);
  const cycle = 1 / GAMMA_HZ;
  const attack = Math.min(o.attackSec, cycle * o.duty * 0.4);
  const onSec = cycle * o.duty;
  const decay = Math.max(1e-4, onSec - attack);
  const tau = decay / 3;                       // about -26 dB by the end of the on-window
  const fade = decay * 0.15;                   // forced to exactly zero, so silence is real

  for (let i = 0; i < n; i++) {
    const tc = ((i * GAMMA_HZ / sr) % 1) / GAMMA_HZ;    // seconds into the current cycle
    let e;
    if (tc < attack) {
      e = 0.5 - 0.5 * Math.cos(Math.PI * tc / attack);  // raised cosine, no click
    } else if (tc < onSec) {
      e = Math.exp(-(tc - attack) / tau);
      const left = onSec - tc;
      if (left < fade) e *= left / fade;
    } else {
      e = 0;
    }
    env[i] = (1 - o.depth) + o.depth * e;
  }
  return env;
}

/* --------------------------------------------------- reference stimuli (A/B) */

/* Kept unchanged in character so they stay comparable to the literature. These bake their own
 * envelope in and run against a flat modulator.
 */
function buildReference(sr, mode) {
  // Noise gets 30 s so it doesn't loop audibly (the seam lands on an envelope null). The others repeat by design.
  const n = mode === 'pink' ? 30 * sr : sr;
  const d = new Float32Array(n);

  if (mode === 'click') {
    // The literal patent spec: a 1 ms 10 kHz tone every 25 ms. Note this is a mouse parameter,
    // and 10 kHz is where human age-related hearing loss bites first.
    const len = Math.round(sr * 0.001);
    for (let c = 0; c < GAMMA_HZ; c++) {
      const off = Math.round(c * sr / GAMMA_HZ);
      for (let i = 0; i < len && off + i < n; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / len);
        d[off + i] = 0.9 * w * Math.sin(2 * Math.PI * 10000 * i / sr);
      }
    }
    return d;
  }

  const env = i => 0.5 - 0.5 * Math.cos(2 * Math.PI * GAMMA_HZ * i / sr);

  if (mode === 'tone') {
    // 250 Hz rather than 220: ASSR amplitude falls monotonically with carrier frequency and 250 Hz
    // is the lowest carrier the frequency-specificity work tested.
    for (let i = 0; i < n; i++) d[i] = 0.9 * env(i) * Math.sin(2 * Math.PI * 250 * i / sr);
    return d;
  }

  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;   // Paul Kellet pink, -3 dB/oct
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    d[i] = env(i) * (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < n; i++) d[i] *= 0.9 / peak;
  return d;
}

/* Measured shape at these values: flat peak across 250-350 Hz, -3 dB at 500, -10 dB at 1 kHz,
 * -22 dB at 4 kHz, and -10 dB at 80 Hz. Energy sits on the empirically best 250-400 Hz window,
 * rolls off gently upward so there is still something to decorrelate for spaciousness, and rolls
 * off steeply below 220 Hz where the +/-40 Hz sidebands start to resolve and stop being useful.
 */
const CARRIER_DEFAULTS = {
  tiltDbOct: 5, lowHz: 220, highHz: 5000, empHz: 350, empDb: 3,
  cohLoHz: 800, cohHiHz: 1200, seed: 1,
};
const ENVELOPE_DEFAULTS = { duty: 0.30, attackSec: 0.002, depth: 0.85 };
const DRIFT_DEFAULTS = { enabled: true, hzL: 0.037, hzR: 0.053, amount: 0.12 };

/* ------------------------------------------------------------------- engine */

/* The graph keeps carrier and envelope physically separate:
 *
 *   shared (mono)      ─────────────────────────┐
 *   decorrelated (st) → split → gainL/gainR → merge ├→ modGain → outGain → destination
 *   envelope (mono)    ──────────────────────────────↗ (wired into modGain.gain)
 *
 * Connecting a source to an AudioParam adds to it, so with modGain.gain.value = 0 the gain simply
 * follows the envelope buffer. Everything starts at one scheduled time, so phase-lock is
 * structural rather than maintained, and the envelope is identical in both ears by construction.
 */
class GammaAudio {
  constructor() {
    this.ctx = null;
    this.startTime = 0;
    this.nodes = [];
    this.carrier = null;          // cached across sessions, rebuilt only on carrier changes
    this.carrierKey = '';
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 0; }

  /* Phase of the audio that is audible right now, in [0,1), or null if there is no clock.
   * Output latency matters: ctx.currentTime is the audio being processed, not the audio in the
   * listener's ears. This is what the visual slaves to.
   */
  phase() {
    if (!this.ctx || !this.startTime) return null;
    const lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    const t = this.ctx.currentTime - lat - this.startTime;
    return t < 0 ? null : (t * GAMMA_HZ) % 1;
  }

  /* Audio clock versus system clock, in ppm. This is the drift that rotates the audiovisual
   * phase relationship if the visual is left free-running on a frame counter.
   */
  driftPpm(perfStartMs) {
    if (!this.ctx || !perfStartMs) return null;
    const audio = this.ctx.currentTime - this.startTime;
    const wall = (performance.now() - perfStartMs) / 1000;
    return wall > 2 ? (audio - wall) / wall * 1e6 : null;
  }

  async ensureCarrier(ctx, opts, onProgress) {
    const key = JSON.stringify(opts) + '@' + ctx.sampleRate;
    if (this.carrierKey === key && this.carrier) return this.carrier;
    this.carrier = await buildTunedCarrier(ctx.sampleRate, opts, onProgress);
    this.carrierKey = key;
    return this.carrier;
  }

  async start(o) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || o.mode === 'off') return null;
    const ctx = this.ctx = new AC();
    await ctx.resume();
    const sr = ctx.sampleRate;

    const buf = data => {
      const b = ctx.createBuffer(1, data.length, sr);
      b.copyToChannel(data, 0);
      return b;
    };
    const loopSrc = b => {
      const s = ctx.createBufferSource();
      s.buffer = b; s.loop = true; this.nodes.push(s);
      return s;
    };

    const outGain = ctx.createGain();
    outGain.gain.value = 0;
    outGain.connect(ctx.destination);

    const modGain = ctx.createGain();
    modGain.gain.value = 0;                 // driven entirely by the envelope buffer
    modGain.connect(outGain);

    // References bake their own envelope in, so they run against a flat modulator.
    const flat = o.mode === 'click' || o.mode === 'tone' || o.mode === 'pink';
    const env = buildEnvelope(sr, flat ? { ...o.envelope, depth: 0 } : o.envelope);
    const envSrc = loopSrc(buf(env));
    envSrc.connect(modGain.gain);

    const sources = [envSrc];
    let stats = null;

    if (o.mode === 'tuned') {
      const c = await this.ensureCarrier(ctx, o.carrier, o.onProgress);
      stats = c.stats;

      sources.push(loopSrc(buf(c.mono)));
      sources[sources.length - 1].connect(modGain);

      const st = ctx.createBuffer(2, c.indL.length, sr);
      st.copyToChannel(c.indL, 0);
      st.copyToChannel(c.indR, 1);
      const stSrc = loopSrc(st);
      sources.push(stSrc);

      // Slow spatial drift, applied only to the decorrelated energy. At 0.04 Hz against a 40 Hz
      // envelope that is a 1000:1 separation, so it cannot contaminate the response, and it is
      // what stops an hour of static noise feeling like a machine.
      if (o.drift && o.drift.enabled) {
        const split = ctx.createChannelSplitter(2);
        const merge = ctx.createChannelMerger(2);
        stSrc.connect(split);
        for (const [ch, hz] of [[0, o.drift.hzL], [1, o.drift.hzR]]) {
          const g = ctx.createGain();
          g.gain.value = 1;
          split.connect(g, ch);
          g.connect(merge, 0, ch);
          const lfo = ctx.createOscillator();
          lfo.frequency.value = hz;
          const depth = ctx.createGain();
          depth.gain.value = o.drift.amount;
          lfo.connect(depth).connect(g.gain);
          this.nodes.push(lfo, g, depth);
          sources.push(lfo);
        }
        merge.connect(modGain);
        this.nodes.push(split, merge);
      } else {
        stSrc.connect(modGain);
      }
    } else if (o.mode === 'music') {
      if (!o.musicBuffer) { await this.stop(); return null; }
      const m = loopSrc(o.musicBuffer);
      m.connect(modGain);
      sources.push(m);
    } else {
      const s = loopSrc(buf(buildReference(sr, o.mode)));
      s.connect(modGain);
      sources.push(s);
    }

    // One scheduled start for everything, so phase-lock is structural.
    const t0 = ctx.currentTime + 0.15;
    for (const s of sources) s.start(t0);
    this.startTime = t0;
    this.nodes.push(modGain, outGain);
    this.outGain = outGain;

    outGain.gain.setValueAtTime(0, t0);
    outGain.gain.linearRampToValueAtTime(o.volume, t0 + 0.4);
    return { sampleRate: sr, outputLatency: ctx.outputLatency || ctx.baseLatency || 0, carrier: stats };
  }

  setVolume(v) {
    if (this.outGain) this.outGain.gain.linearRampToValueAtTime(v, this.ctx.currentTime + 0.05);
  }

  async stop() {
    const ctx = this.ctx;
    if (!ctx) return;
    const nodes = this.nodes;
    if (this.outGain) this.outGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
    this.ctx = null; this.nodes = []; this.outGain = null; this.startTime = 0;
    setTimeout(() => {
      for (const n of nodes) { try { n.stop && n.stop(); } catch {} }
      try { ctx.close(); } catch {}
    }, 320);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildTunedCarrier, buildEnvelope, buildReference, spectralShape,
                     coherenceWeight, CARRIER_DEFAULTS, ENVELOPE_DEFAULTS, DRIFT_DEFAULTS, GAMMA_HZ };
}
