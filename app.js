/* 40 Hz gamma stimulus, proof of concept.
 *
 * Two things matter here and nothing else does:
 *   1. A display cannot produce a periodic modulation faster than half its refresh rate, and a
 *      clean 40 Hz square wave needs the refresh to be a whole multiple of 40. So 120/240/360/480
 *      work and 60/90/144/165 do not. This gates everything.
 *   2. On OLED the contrast ratio is already maxed, so HDR buys absolute luminance amplitude in
 *      cd/m2, which is what the dose-response literature is denominated in.
 *
 * See findings.md.
 */

'use strict';

const TARGET_HZ = 40;
const VIDEO_SRC = 'dist/gamma40-120fps.mp4';
const FIELD_PX = 32;   // canvas backing size; see makeGpuField

const $ = id => document.getElementById(id);
const set = (id, txt, cls) => { const e = $(id); if (!e) return; e.textContent = txt; e.className = cls || 'dim'; };

/* ------------------------------------------------------------------ colour */

// Linear-light luminance coefficients. Which set applies depends on the canvas colour space.
const LUMA = {
  'srgb':       [0.2126, 0.7152, 0.0722],
  'display-p3': [0.2290, 0.6917, 0.0793],
};

// Isoluminant pair on the blue/green axis.
//
// White [L,L,L], pure green [0, L/kg, 0] and pure blue [0, 0, L/kb] all have luminance exactly L,
// and luminance is linear, so any convex combination of them also has luminance L. That gives a
// free saturation knob: chroma 1 is the full green/blue pair (maximum cone contrast) and chroma 0
// is two identical whites (no stimulus at all).
//
// It matters because blue carries only ~7% of luminance, so a full-saturation pair needs ~13.9x
// SDR white on the blue channel. Past about 0.3 chroma you buy back most of the luminance for a
// modest loss of cone contrast, which is the difference between a usable stimulus and a dim one.
function isoluminantPair(L, chroma, space) {
  const k = LUMA[space] || LUMA.srgb;
  const c = Math.max(0, Math.min(1, chroma));
  const w = (1 - c) * L;
  return {
    on:  [w, w + c * L / k[1], w],   // toward green
    off: [w, w, w + c * L / k[2]],   // toward blue
  };
}

// Largest channel value the pair will ask for, ie. the headroom it needs to render unclipped.
function isoluminantPeak(L, chroma, space) {
  const k = LUMA[space] || LUMA.srgb;
  const c = Math.max(0, Math.min(1, chroma));
  return L * (1 - c + c / k[2]);
}

function luminancePair(L, floor) {
  return { on: [L, L, L], off: [L * floor, L * floor, L * floor] };
}

const srgbEncode = v => {
  v = Math.max(0, Math.min(1, v));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};
const cssFromLinear = c =>
  'rgb(' + c.map(v => Math.round(srgbEncode(v) * 255)).join(',') + ')';

/* ------------------------------------------------- capability measurement */

const caps = {
  hz: 0, framesPerCycle: 0, eligible: false, medianInterval: 0,
  gpu: null, gpuSpace: null, hdr: false, video: null,
};

function collectFrames(ms) {
  return new Promise(res => {
    const t = []; let start = null;
    const tick = now => {
      if (start === null) start = now;
      t.push(now);
      if (now - start < ms) requestAnimationFrame(tick); else res(t);
    };
    requestAnimationFrame(tick);
  });
}

function analyse(stamps) {
  const d = [];
  for (let i = 1; i < stamps.length; i++) d.push(stamps[i] - stamps[i - 1]);
  const s = d.slice().sort((a, b) => a - b);
  const median = s[s.length >> 1];
  return {
    median, p95: s[Math.floor(s.length * 0.95)], hz: 1000 / median,
    late: d.filter(x => x > median * 1.5).length, n: d.length,
  };
}

// Snap to the nearest plausible panel rate so 119.88 does not read as ineligible.
const PANEL_RATES = [24, 30, 48, 50, 60, 75, 80, 90, 100, 120, 144, 165, 175, 200, 240, 360, 480];
const snap = hz => PANEL_RATES.reduce((b, k) => Math.abs(k - hz) < Math.abs(b - hz) ? k : b, 60);

async function probeGpu() {
  if (!navigator.gpu) return { ok: false, why: 'no WebGPU in this browser' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, why: 'no GPU adapter' };
    const device = await adapter.requestDevice();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('webgpu');

    // Prefer display-p3 for the chromatic mode, fall back to srgb.
    let space = 'srgb';
    for (const trial of ['display-p3', 'srgb']) {
      try {
        ctx.configure({ device, format: 'rgba16float', colorSpace: trial,
                        toneMapping: { mode: 'extended' }, alphaMode: 'opaque' });
        const got = ctx.getConfiguration ? ctx.getConfiguration() : null;
        if (!got || got.colorSpace === trial) { space = trial; break; }
      } catch { /* try the next one */ }
    }
    const conf = ctx.getConfiguration ? ctx.getConfiguration() : null;
    const mode = conf && conf.toneMapping && conf.toneMapping.mode;
    if (conf && mode !== 'extended') return { ok: false, why: 'tone mapping fell back to ' + mode };
    return { ok: true, device, space, verified: !!conf };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

function probeStatic() {
  const mq = q => { try { return matchMedia(q).matches; } catch { return null; } };
  const yn = v => v === null ? ['query unsupported', 'dim'] : v ? ['yes', 'ok'] : ['no', 'warn'];

  set('cDpr', String(devicePixelRatio));
  set(...['cMqDR', ...yn(mq('(dynamic-range: high)'))]);
  set(...['cMqVDR', ...yn(mq('(video-dynamic-range: high)'))]);
  set(...['cDrl', ...yn(CSS.supports && CSS.supports('dynamic-range-limit', 'no-limit'))]);

  const v = document.createElement('video');
  const h = v.canPlayType('video/mp4; codecs="hvc1.2.4.L123.B0"');   // HEVC Main10
  set('cHevc', h || 'no', h === 'probably' ? 'ok' : h ? 'warn' : 'bad');
  const a = v.canPlayType('video/mp4; codecs="av01.0.05M.10.0.110.09.16.09.0"');  // AV1 10-bit PQ
  set('cAv1', a || 'no', a === 'probably' ? 'ok' : a ? 'warn' : 'bad');

  const AC = window.AudioContext || window.webkitAudioContext;
  set('cSr', AC ? 'checked when sound starts' : 'no Web Audio', AC ? 'dim' : 'bad');

  caps.hdr = mq('(dynamic-range: high)') === true;
}

async function measure() {
  set('cHz', 'measuring...', 'dim');
  $('remeasure').disabled = true;
  caps.measured = false;
  renderLanding();

  const a = analyse(await collectFrames(2500));
  caps.medianInterval = a.median;
  caps.hz = snap(a.hz);
  caps.framesPerCycle = caps.hz / TARGET_HZ;
  caps.eligible = Number.isInteger(caps.framesPerCycle);

  set('cHz', `${a.hz.toFixed(2)} Hz  (reads as ${caps.hz} Hz)`, caps.hz >= 120 ? 'ok' : 'warn');
  set('cInt', `${a.median.toFixed(3)} / ${a.p95.toFixed(3)} ms`,
      a.p95 > a.median * 1.4 ? 'warn' : 'ok');
  set('cLate', `${a.late} of ${a.n}`, a.late ? 'warn' : 'ok');

  const dutySel = $('duty');
  dutySel.innerHTML = '';
  if (caps.eligible) {
    set('cElig', `yes, ${caps.framesPerCycle} frames per 40 Hz cycle`, 'ok');
    const opts = [];
    const best = Math.max(1, Math.round(caps.framesPerCycle / 3));   // a third on, 1 frame in 3 at 120 Hz
    for (let on = 1; on < caps.framesPerCycle; on++) {
      const pct = 100 * on / caps.framesPerCycle;
      opts.push(`${pct.toFixed(1)}%`);
      const o = document.createElement('option');
      o.value = String(on);
      o.textContent = `${on}/${caps.framesPerCycle} = ${pct.toFixed(1)}%`;
      if (on === best) o.defaultSelected = o.selected = true;       // defaultSelected is what Reset goes back to
      dutySel.appendChild(o);
    }
    restoreDuty();
    set('cDuty', opts.join('   '), 'ok');
  } else {
    const why = caps.hz <= 80
      ? `A ${caps.hz} Hz screen tops out at ${caps.hz / 2} Hz, so 40 Hz comes out as 20 Hz.`
      : `${caps.hz} divided by 40 isn't a whole number, so the timing would wobble.`;
    set('cElig', 'No. ' + why, 'bad');
    set('cDuty', 'n/a', 'bad');
    const o = document.createElement('option');
    o.value = '1'; o.textContent = 'n/a';
    dutySel.appendChild(o);
  }

  caps.measured = true;
  renderVerdict();
  applyAutoLevel();
  refreshControls();
  $('remeasure').disabled = false;
}

function renderVerdict() {
  const el = $('verdict');
  const gpuOk = caps.gpu && caps.gpu.ok;
  let tier, html;

  if (!caps.eligible) {
    tier = 'tier-none';
    html = `<b>No light on this screen.</b>
      <span class="why">A ${caps.hz} Hz screen can't show 40 Hz cleanly,
      ${caps.hz <= 80 ? 'it comes out at 20 Hz' : 'the timing wobbles'}. Sound still runs at exactly
      40 Hz. Try the light on a 120 Hz screen.</span>`;
  } else if (gpuOk && caps.hdr) {
    tier = 'tier-full';
    html = `<b>Everything's available.</b> ${caps.hz} Hz, ${caps.framesPerCycle} frames per cycle, HDR on.
      <span class="why">As good as a browser gets. Only a light sensor can confirm it.</span>`;
  } else if (gpuOk) {
    tier = 'tier-sdr';
    html = `<b>Timing's good, no HDR.</b> ${caps.hz} Hz, but this screen doesn't report HDR.
      <span class="why">Brightness tops out at normal white.</span>`;
  } else {
    tier = 'tier-sdr';
    html = `<b>Timing's good, basic drawing only.</b> ${caps.hz} Hz, but no WebGPU here
      (${caps.gpu ? caps.gpu.why : 'not checked yet'}).
      <span class="why">The light still runs, just no brighter than normal white.</span>`;
  }
  el.className = 'verdict ' + tier;
  el.innerHTML = html;
}

/* ------------------------------------------------------------- renderers */

function makeGpuField(parent, wCss, hCss) {
  const { device, space } = caps.gpu;
  const canvas = document.createElement('canvas');
  // A flat field has no detail, so render a tiny canvas and let the browser stretch it. At device resolution
  // in rgba16float that is ~60 MB a frame on a 16-inch MacBook Pro, cleared 120 times a second for one colour.
  canvas.width = canvas.height = FIELD_PX;
  const size = (w, h) => {
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  };
  size(wCss, hCss);
  parent.insertBefore(canvas, $('hud'));

  const ctx = canvas.getContext('webgpu');
  ctx.configure({ device, format: 'rgba16float', colorSpace: space,
                  toneMapping: { mode: 'extended' }, alphaMode: 'opaque' });

  return {
    space,
    // A flat field needs no shader. A clear colour on an rgba16float extended-range canvas is
    // linear light where 1.0 is SDR white, so values above 1.0 are the HDR headroom.
    draw(c) {
      const enc = device.createCommandEncoder();
      enc.beginRenderPass({ colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        clearValue: { r: c[0], g: c[1], b: c[2], a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }] }).end();
      device.queue.submit([enc.finish()]);
    },
    resize: size,
    destroy() { canvas.remove(); },
  };
}

function makeDomField(parent, wCss, hCss) {
  const div = document.createElement('div');
  div.id = 'domfield';
  const size = (w, h) => { div.style.width = w + 'px'; div.style.height = h + 'px'; };
  size(wCss, hCss);
  div.style.dynamicRangeLimit = 'no-limit';
  parent.insertBefore(div, $('hud'));
  let last = '';
  return {
    space: 'srgb',
    draw(c) { const s = cssFromLinear(c); if (s !== last) { div.style.background = s; last = s; } },
    resize: size,
    destroy() { div.remove(); },
  };
}


/* --------------------------------------------------------------- session */

let session = null;

function stimulusColours() {
  const L = Number($('level').value);
  const mode = $('mode').value;
  const space = (caps.gpu && caps.gpu.ok) ? caps.gpu.space : 'srgb';
  return mode === 'chromatic'
    ? isoluminantPair(L, Number($('chroma').value), space)
    : luminancePair(L, Number($('floor').value));
}

function audioOptions() {
  return {
    mode: $('audio').value,
    volume: Number($('vol').value),
    musicBuffer,
    envelope: {
      ...ENVELOPE_DEFAULTS,
      duty: Number($('aDuty').value),
      depth: Number($('aDepth').value),
    },
    carrier: {
      ...CARRIER_DEFAULTS,
      tiltDbOct: Number($('aTilt').value),
      empDb: Number($('aEmp').value),
      cohLoHz: Number($('aCoh').value),
      cohHiHz: Number($('aCoh').value) * 1.5,
    },
    drift: { ...DRIFT_DEFAULTS, enabled: $('aDrift').checked },
  };
}

async function beginSession(opts) {
  if (session) return;
  const stage = $('stage');

  // Audio context and fullscreen both need the user gesture, so claim them before any await.
  const audio = new GammaAudio();
  audio.carrier = prebuilt.carrier;          // reuse the background build if the settings match
  audio.carrierKey = prebuilt.key;
  const audioStarting = audio.start(audioOptions());
  stage.hidden = false;
  showHint(opts.light);
  $('sizeCtl').hidden = !opts.light;
  $('sizeV').textContent = Math.round(Number($('field').value) * 100) + '%';
  wake(TOUCH() ? 30000 : 4000);
  const fs = !$('fullscreen').checked ? Promise.resolve()
           : stage.requestFullscreen ? stage.requestFullscreen({ navigationUI: 'hide' })
           : stage.webkitRequestFullscreen ? Promise.resolve(stage.webkitRequestFullscreen())
           : Promise.resolve();

  session = {
    audio, wakeLock: null, raf: 0, video: null, field: null,
    mode: opts.light ? ($('source').value === 'video' ? 'video' : 'canvas') : 'audio',
    frames: 0, first: 0, prev: 0, dropped: 0, longestGap: 0,
    fpc: caps.framesPerCycle, hudAt: 0,
    lastSlot: null, resyncs: 0, genlocked: false, perfStart: performance.now(), startedAt: performance.now(),
    endAt: Number($('dur').value) > 0 ? performance.now() + Number($('dur').value) * 1000 : Infinity,
  };
  // The loops check endAt, but rAF stops in a background tab, and without fullscreen people switch tabs. A timer
  // still ends the session on time (to the second, background timers are throttled).
  if (session.endAt !== Infinity) {
    session.endTimer = setTimeout(() => endSession('completed'), session.endAt - performance.now());
  }

  await fs.catch(() => {});          // iOS Safari has no element fullscreen; the fixed stage covers it
  const info = await audioStarting.catch(() => null);
  if (!session) return;              // stopped while we were awaiting
  if (info) {
    session.audioInfo = info;
    set('cSr', `${info.sampleRate} Hz  (${(info.sampleRate / TARGET_HZ).toFixed(1)} samples per ` +
        `40 Hz cycle, ${(info.outputLatency * 1000).toFixed(1)} ms output latency)`, 'ok');
  }
  try { session.wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  if (!session) return;

  const [w, h] = fieldPx();

  if (session.mode === 'video') {
    const v = document.createElement('video');
    v.src = VIDEO_SRC; v.loop = true; v.muted = true; v.playsInline = true;
    v.style.width = w + 'px'; v.style.height = h + 'px';
    stage.insertBefore(v, $('hud'));
    session.video = v;
    try {
      await v.play();
    } catch (e) {
      return endSession('video failed: ' + e.message + '. Run make-gamma.sh first.');
    }
    if (!session) return;
    if (v.requestVideoFrameCallback) {
      // presentedFrames is the only honest drop counter on this path: rAF cannot see video
      // frames, and the compositor may present a frame a vsync after the callback fires.
      let lastPresented = 0, firstTs = 0;
      const onFrame = (ts, meta) => {
        if (!session) return;
        if (lastPresented) {
          const step = meta.presentedFrames - lastPresented;
          if (step > 1) session.dropped += step - 1;
          const gap = ts - session.prev;
          if (gap > session.longestGap) session.longestGap = gap;
        } else { firstTs = ts; session.first = ts; }
        session.prev = ts;
        session.frames++;
        void firstTs;
        v.requestVideoFrameCallback(onFrame);
      };
      v.requestVideoFrameCallback(onFrame);
    } else {
      session.noTelemetry = true;
    }
  } else if (session.mode === 'canvas') {
    const { on, off } = stimulusColours();
    session.field = (caps.gpu && caps.gpu.ok) ? makeGpuField(stage, w, h) : makeDomField(stage, w, h);
    session.on = on;
    session.off = off;
    session.onFrames = Math.min(Number($('duty').value) || 1, session.fpc - 1);
  }

  session.raf = requestAnimationFrame(session.mode === 'canvas' ? canvasLoop : passiveLoop);
}

// Canvas path only: rAF frames are the stimulus frames, so gaps are holes in the stimulus.
function accumulate(now) {
  const s = session;
  if (!s.first) { s.first = now; s.prev = now; return; }
  const gap = now - s.prev;
  s.prev = now;
  if (gap > s.longestGap) s.longestGap = gap;
  const expected = caps.medianInterval || (1000 / caps.hz);
  if (gap > expected * 1.5) s.dropped += Math.max(0, Math.round(gap / expected) - 1);
}

function updateHud(now) {
  const s = session;
  if ($('hud').hidden || now - s.hudAt < 250) return;
  s.hudAt = now;
  const el = Math.max(0, (now - (s.first || now)) / 1000);
  const rate = el > 0 && s.frames > 1 ? (s.frames - 1) / el : 0;
  const expectedFrames = Math.round(el * caps.hz);
  const dropPct = expectedFrames ? 100 * s.dropped / expectedFrames : 0;

  let body;
  if (s.mode === 'audio') {
    body = `sound only, exact\n`;
  } else if (s.noTelemetry) {
    body = `${s.mode} path, no requestVideoFrameCallback so no telemetry\n`;
  } else {
    body = `${rate.toFixed(2)} fps     ${(rate / s.fpc).toFixed(3)} Hz delivered\n` +
           `dropped ${s.dropped} (${dropPct.toFixed(2)}%)     longest gap ${s.longestGap.toFixed(1)} ms\n`;
  }
  if (s.genlocked) {
    const ppm = s.audio.driftPpm(s.perfStart);
    body += `synced to sound, ${s.resyncs} resync` + (s.resyncs === 1 ? '' : 's') +
            (ppm === null ? '' : `, drift ${ppm >= 0 ? '+' : ''}${ppm.toFixed(1)} ppm`) + '\n';
  }
  $('hud').textContent =
    `${((now - s.startedAt) / 1000).toFixed(1)}s / ${Number($('dur').value) > 0 ? $('dur').value + 's' : 'unlimited'}` +
    `     target 40.00 Hz     ${s.mode}\n` + body + 'esc or click to stop';
}

/* Which frame slot of the 40 Hz cycle this frame belongs to.
 *
 * Slaved to the audio clock rather than counted off frames. The audio crystal and the display
 * clock are independent oscillators, so at a typical +/-50 ppm a free-running frame counter drifts
 * about 180 ms per hour against the audio. One 40 Hz cycle is 25 ms, so the audiovisual phase
 * relationship would rotate through roughly seven full cycles over a session. Since the evidence
 * for combined audiovisual stimulation rests on the two being coupled, that matters.
 *
 * Slaving trades continuous rotation for an occasional single-frame correction, about one every
 * three minutes at 50 ppm. Those corrections are counted and reported.
 */
function frameSlot(s) {
  const ph = s.audio.phase();
  if (ph === null) return { slot: s.frames % s.fpc, locked: false };   // no audio clock, free-run
  return { slot: Math.floor(ph * s.fpc) % s.fpc, locked: true };
}

function canvasLoop(now) {
  const s = session;
  if (!s) return;
  accumulate(now);

  const { slot, locked } = frameSlot(s);
  if (locked) {
    s.genlocked = true;
    if (s.lastSlot !== null && slot !== (s.lastSlot + 1) % s.fpc) s.resyncs++;
  }
  s.lastSlot = slot;
  s.field.draw(slot < s.onFrames ? s.on : s.off);

  s.frames++;
  updateHud(now);
  if (now >= s.endAt) return endSession('completed');
  s.raf = requestAnimationFrame(canvasLoop);
}

// Video and audio-only paths do their own accounting (or need none), so this just drives the
// HUD and the end-of-session timer. It must not touch s.frames or it double-counts.
function passiveLoop(now) {
  const s = session;
  if (!s) return;
  updateHud(now);
  if (now >= s.endAt) return endSession('completed');
  s.raf = requestAnimationFrame(passiveLoop);
}

function endSession(reason) {
  const s = session;
  if (!s) return;
  session = null;
  cancelAnimationFrame(s.raf);
  clearTimeout(s.endTimer);
  clearTimeout(idleTimer);
  $('stage').classList.remove('idle');
  if (s.field) s.field.destroy();
  if (s.video) { s.video.pause(); s.video.remove(); }
  s.audio.stop();
  if (s.wakeLock) { try { s.wakeLock.release(); } catch {} }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.webkitFullscreenElement) { try { document.webkitExitFullscreen(); } catch {} }
  $('stage').hidden = true;
  $('hud').textContent = '';
  $('hud').hidden = true;
  hideHint();

  const el = Math.max(0, (s.prev - s.first) / 1000);
  const rate = el > 0 && s.frames > 1 ? (s.frames - 1) / el : 0;
  const expectedFrames = Math.round(el * caps.hz);
  const dropPct = expectedFrames ? 100 * s.dropped / expectedFrames : 0;
  const wall = ((s.startedAt ? performance.now() - s.startedAt : 0) / 1000).toFixed(2);

  set('rDur', `${wall} s  (${reason})`);
  showResult(s, reason, Number(wall), dropPct);

  const ppm = s.audio.driftPpm(s.perfStart);
  set('rDrift', ppm === null ? 'not measurable' : `${ppm >= 0 ? '+' : ''}${ppm.toFixed(2)} ppm`,
      ppm === null ? 'dim' : Math.abs(ppm) < 100 ? 'ok' : 'warn');
  if (s.genlocked) {
    const perHour = wall > 0 ? s.resyncs * 3600 / Number(wall) : 0;
    set('rGenlock', `${s.resyncs} resync${s.resyncs === 1 ? '' : 's'} ` +
        `(~${perHour.toFixed(0)}/hour, one frame each)`, 'ok');
  } else {
    set('rGenlock', s.mode === 'audio' ? 'n/a' : 'not synced, no sound playing', 'warn');
  }

  if (s.mode === 'audio') {
    ['rFrames', 'rRate', 'rCycles', 'rDrop', 'rGap'].forEach(id => set(id, 'n/a'));
    set('rVerdict', 'Sound only, exact by design.', 'ok');
    return;
  }
  if (s.noTelemetry) {
    ['rFrames', 'rRate', 'rCycles', 'rDrop', 'rGap'].forEach(id => set(id, 'unavailable'));
    set('rVerdict', "This browser can't report video frames, so there's nothing to measure.", 'warn');
    return;
  }

  set('rFrames', String(s.frames));
  set('rRate', `${rate.toFixed(2)} fps`, Math.abs(rate - caps.hz) < 1.5 ? 'ok' : 'bad');
  set('rCycles', `${Math.floor(s.frames / s.fpc)} of ${Math.round(el * TARGET_HZ)} expected`);
  set('rDrop', `${s.dropped} (${dropPct.toFixed(3)}%)`,
      dropPct < 0.1 ? 'ok' : dropPct < 1 ? 'warn' : 'bad');
  set('rGap', `${s.longestGap.toFixed(2)} ms`,
      s.longestGap < caps.medianInterval * 2 ? 'ok' : 'warn');
  set('rVerdict',
    dropPct < 0.1 ? 'Clean. The browser thinks it hit 40 Hz (only a light sensor can confirm).'
    : dropPct < 1 ? 'Mostly clean, a few gaps in the flicker.'
    : "Not usable. Too many dropped frames, so it isn't really 40 Hz.",
    dropPct < 0.1 ? 'ok' : dropPct < 1 ? 'warn' : 'bad');
}

/* ------------------------------------------------------------- audio ui */

let musicBuffer = null;
const prebuilt = { carrier: null, key: '' };

/* The carrier takes ~600 ms to synthesise, so build it in the background once the refresh-rate
 * measurement is done. Building it during the measurement would corrupt the measurement.
 */
async function prebuildCarrier() {
  const opts = audioOptions();
  if (opts.mode !== 'tuned') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!prebuilt.sr) {                    // probe the rate once, do not leak the context
    const probe = new AC();
    prebuilt.sr = probe.sampleRate;
    probe.close();
  }
  const sr = prebuilt.sr;
  const key = JSON.stringify(opts.carrier) + '@' + sr;
  if (prebuilt.key === key) return;

  set('cCarrier', 'synthesising...', 'dim');
  const c = await buildTunedCarrier(sr, opts.carrier,
    p => set('cCarrier', `synthesising... ${(p * 100).toFixed(0)}%`, 'dim'));
  prebuilt.carrier = c;
  prebuilt.key = key;
  set('cCarrier', `${Math.round(c.stats.loopSec)} s before it repeats, ${c.stats.tones.toLocaleString()} tones, ` +
      `built in ${c.stats.ms} ms`, 'ok');
}

let prebuildTimer = 0;
function schedulePrebuild() {
  clearTimeout(prebuildTimer);
  prebuildTimer = setTimeout(() => { if (!session) prebuildCarrier(); }, 400);
}

function refreshAudioControls() {
  const mode = $('audio').value;
  const tuned = mode === 'tuned';
  $('ctlCarrier').classList.toggle('hidden', !tuned);
  $('ctlCarrier2').classList.toggle('hidden', !tuned);
  $('ctlCoh').classList.toggle('hidden', !tuned);
  $('ctlDrift').classList.toggle('hidden', !tuned);
  $('ctlMusic').classList.toggle('hidden', mode !== 'music');
  $('ctlEnv').classList.toggle('hidden', mode !== 'tuned' && mode !== 'music');

  const duty = Number($('aDuty').value), depth = Number($('aDepth').value);
  set('aDutyV', `${(duty * 100).toFixed(0)}%`);
  set('aDepthV', `${(depth * 100).toFixed(0)}%`);
  set('aTiltV', `-${Number($('aTilt').value).toFixed(1)} dB/oct`);
  set('aEmpV', `+${Number($('aEmp').value).toFixed(1)} dB`);
  set('aCohV', `${$('aCoh').value} Hz`);

  $('aDutyNote').textContent = duty <= 0.5
    ? 'under 50% is what the research favors'
    : 'over 50%, past what the research favors';
  $('aDepthNote').textContent = depth >= 0.99
    ? 'silent between pulses'
    : `${((1 - depth) * 100).toFixed(0)}% volume between pulses`;

  $('audioNote').textContent = {
    tuned: 'same pulse in both ears, a little stereo width in the highs',
    music: 'your music, pulsed at 40 Hz',
    click: "the original study's clicks. Tuned for mice, shrill for people.",
    tone:  'a single pulsing tone, the weakest option',
    pink:  'plain pink noise, for comparison',
    off:   'no sound, so the light runs on its own clock',
  }[mode] || '';

  if (tuned) schedulePrebuild();
}

/* Safari holds pages to 60 fps on a 120 Hz screen, and to 30 in Low Power Mode. Only the user can lift that, so the
 * Light row offers the steps. Other iOS browsers share Safari's engine but not its settings, so they get nothing.
 */
const SAFARI = (() => {
  const ua = navigator.userAgent;
  const other = /Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|OPR\//;
  if (!/Safari\//.test(ua) || !/Version\//.test(ua) || other.test(ua)) return null;
  return /iPhone|iPad|iPod/.test(ua) || navigator.maxTouchPoints > 1 ? 'ios' : 'mac';   // iPadOS reports as a Mac
})();

function renderSafariFix(light) {
  const show = !!SAFARI && !light && (caps.hz === 30 || caps.hz === 60);
  $('lightFix').hidden = !show;
  if (!show) return;
  const ios = SAFARI === 'ios';
  $('fixMac').hidden = ios;
  $('fixIos').hidden = !ios;
  $('fixLpm').hidden = caps.hz !== 30;
  $('fixLpm').textContent = 'Low Power Mode halves it again, to 30. Turn that off first, in ' +
    (ios ? 'Settings → Battery.' : 'System Settings → Battery.');
  $('fixNote').textContent = ios
    ? 'Only helps on a 120\u00a0Hz screen: Pro iPhones from the 13 Pro on, iPhone 17 and Air, and iPad Pro.'
    : 'Only helps on a 120\u00a0Hz screen, like a MacBook Pro from 2021 on. Other Macs top out at 60.';
}

/* ----------------------------------------------------------- landing */

/* One screen: test runs, plain result, a mild click-through only when there is light to warn about,
 * then a single button that turns on whatever this device can do. Numbers live in the stats pane.
 */
function renderLanding() {
  const testing = !caps.measured;
  const soundOn = $('audio').value !== 'off' && !!(window.AudioContext || window.webkitAudioContext);
  const light = caps.eligible;

  // The card keeps its rows and the gate only ever appears below it, so finishing the test grows the page
  // downward and nothing already on screen moves.
  $('chips').classList.toggle('pending', testing);
  $('wordmark').classList.toggle('live', !testing);
  $('gate').hidden = testing;
  if (testing) {
    $('lightFix').hidden = true;
    for (const id of ['okSound', 'okLight', 'okHdr']) $(id).hidden = true;
    for (const id of ['chipSound', 'chipLight', 'chipHdr']) set(id, 'checking', 'dim');
    return;
  }

  set('chipSound', soundOn ? 'ready' : $('audio').value === 'off' ? 'off in settings' : 'not supported',
      soundOn ? 'ok' : 'dim');
  set('chipLight', light ? `${caps.hz} Hz screen` : `${caps.hz} Hz can't show 40 Hz`,
      light ? 'ok' : 'dim');
  renderSafariFix(light);
  const hdr = caps.hdr && caps.gpu && caps.gpu.ok;
  set('chipHdr', !light ? 'not used without light' : hdr ? 'HDR, extra bright' : 'standard',
      light && hdr ? 'ok' : 'dim');
  $('okSound').hidden = !soundOn;
  $('okLight').hidden = !light;
  $('okHdr').hidden = !(light && hdr);

  // The warning only means something when light is on offer. Sound alone needs no gate.
  $('gateText').hidden = !light;
  $('gateStop').textContent = matchMedia('(hover: none)').matches
    ? 'Tap anywhere to stop.' : 'Click anywhere or hit Esc to stop.';
  $('start').hidden = !light;
  // Beside the light this button is the sound-only option. Alone it's the way in, so it gets the play icon.
  const off = $('lightOff');
  const label = (icon, text) => {
    off.querySelector('i').hidden = !icon;
    if (icon) off.querySelector('i').textContent = String.fromCodePoint(icon);
    off.querySelector('span').textContent = text;
  };
  off.hidden = !soundOn;
  off.classList.toggle('primary', !light);
  label(light ? 0xE44A : 0xE3D0, light ? 'Sound only' : 'Begin');
  if (!light && !soundOn) {
    off.hidden = false;
    off.disabled = true;
    label(0, "Sound's off in settings, nothing to run");
  } else {
    off.disabled = false;
  }
}

/* Pick a light level the display can render without clipping. Real HDR headroom is hidden from the
 * web, so assume a conservative 3x when HDR is reported and exactly SDR white when it is not. A
 * clipped isoluminant pair stops being isoluminant, which brings back the luminance flicker the
 * mode exists to avoid. Runs once both probes are in, and never after the user touches the slider.
 */
let levelTouched = false;
/* The level this device should default to, or null until the measurement and GPU probe are in. */
function autoLevel() {
  if (!caps.measured || !caps.gpu) return null;
  const space = caps.gpu.ok ? caps.gpu.space : 'srgb';
  const headroom = caps.hdr && caps.gpu.ok ? 3 : 1;
  let lvl;
  if ($('mode').value === 'luminance') {
    // Brighter entrains better (400 to 700 cd/m2 beat 100 in older adults), so lean on HDR when it's there.
    lvl = headroom > 1 ? 2 : 1;
  } else {
    const perUnit = isoluminantPeak(1, Number($('chroma').value), space);
    lvl = Math.floor(20 * headroom / perUnit) / 20;               // the slider steps in 0.05
  }
  return Math.max(0.05, Math.min(10, lvl));
}
function applyAutoLevel() {
  const lvl = autoLevel();
  if (!levelTouched && lvl !== null) $('level').value = String(lvl);
}

const fmtTime = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function showResult(s, reason, wallSec, dropPct) {
  let msg = reason === 'completed' ? `Session complete, ${fmtTime(wallSec)}.`
          : reason === 'stopped' ? `Stopped after ${fmtTime(wallSec)}.`
          : `Session ended: ${reason}`;
  if (s.mode === 'canvas' && dropPct >= 1) msg += ' A few frames dropped, details in stats.';
  set('result', msg, reason === 'completed' || reason === 'stopped' ? 'dim' : 'bad');
  $('result').hidden = false;
  $('start').querySelector('span').textContent = 'Begin again';
  if (!caps.eligible) $('lightOff').querySelector('span').textContent = 'Begin again';
}

/* The stop hint stays for the first 30 seconds, then gets out of the way of the stimulus. */
let hintTimer = 0;
function showHint(light) {
  const touch = matchMedia('(hover: none)').matches;
  $('hint').textContent = touch ? 'Tap to stop'
    : 'Click or Esc to stop  ·  S for stats' + (light ? '  ·  + and − to resize' : '');
  $('hint').classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(hideHint, 30000);
}
function hideHint() { clearTimeout(hintTimer); $('hint').classList.remove('show'); }

/* Panes are native <dialog>s: focus trapping and Esc-to-close come free. */
for (const [btn, pane] of [['openStats', 'statsPane'], ['openConfig', 'configPane'], ['lightFix', 'fixPane']]) {
  $(btn).addEventListener('click', () => $(pane).showModal());
  $(pane).addEventListener('click', e => { if (e.target === $(pane)) $(pane).close(); });   // backdrop
  $(pane).querySelector('[data-close]').addEventListener('click', () => $(pane).close());
}
$('level').addEventListener('input', () => { levelTouched = Number($('level').value) !== autoLevel(); });
$('mode').addEventListener('input', () => { applyAutoLevel(); refreshControls(); });

/* ------------------------------------------------------------------- ui */

function refreshControls() {
  const chromatic = $('mode').value === 'chromatic';
  const video = $('source').value === 'video';
  const L = Number($('level').value);
  const space = (caps.gpu && caps.gpu.ok) ? caps.gpu.space : 'srgb';
  const k = LUMA[space] || LUMA.srgb;

  $('ctlFloor').classList.toggle('hidden', chromatic || video);
  $('ctlChroma').classList.toggle('hidden', !chromatic || video);
  $('ctlMode').classList.toggle('hidden', video);

  set('cGpu', caps.gpu ? (caps.gpu.ok
        ? `yes (rgba16float, extended${caps.gpu.verified ? '' : ', unverified'})`
        : 'no: ' + caps.gpu.why) : 'probing...',
      caps.gpu && caps.gpu.ok ? 'ok' : 'warn');
  set('cSpace', space + (space === 'display-p3' ? '  (wider colour, stronger shimmer)' : ''),
      space === 'display-p3' ? 'ok' : 'dim');

  set('levelV', L.toFixed(2) + 'x');
  const c = Number($('chroma').value);
  if (chromatic && !video) {
    const peak = isoluminantPeak(L, c, space);
    const clamps = !caps.hdr && peak > 1;
    $('levelNote').textContent =
      `blue needs ${peak.toFixed(2)}x normal white` +
      (clamps ? `  ...  too bright without HDR, max here is ${(1 / (1 - c + c / k[2])).toFixed(3)}x`
              : '');
    $('levelNote').className = clamps ? 'bad' : 'dim';
    set('chromaV', c === 0 ? '0%  (off)' : (c * 100).toFixed(0) + '%');
    $('chromaNote').textContent =
      c >= 0.95 ? 'pure green and blue, strongest but dimmest'
      : c <= 0.05 ? 'two identical whites, no flicker at all'
      : `blue needs ${(1 - c + c / k[2]).toFixed(2)}x per unit of brightness`;
  } else {
    $('levelNote').textContent = caps.hdr || L <= 1 ? '' : 'above 1.0x needs HDR';
    $('levelNote').className = 'dim';
  }

  const fs = Number($('field').value);
  set('fieldV', Math.round(fs * 100) + '%');
  $('fieldNote').textContent = fs <= 0.4 ? 'small enough that OLED screens stop dimming it'
    : 'smaller can help a screen that stutters';
  const f = Number($('floor').value);
  set('floorV', f === 0 ? '0%  (fully dark)' : `${(f * 100).toFixed(0)}%  (depth ${(100 - f * 100).toFixed(0)}%)`);
  set('volV', Math.round(Number($('vol').value) * 100) + '%');

  refreshAudioControls();

  $('modeNote').textContent = chromatic
    ? 'easier on the eyes, but colour mostly fades out by 40 Hz'
    : 'what the studies used, and the strongest 40 Hz response';
  $('sourceNote').textContent = video
    ? 'plays a prerendered 120 fps video'
    : 'drawn live, a busy tab can cause small gaps';

  renderDefaults();
  renderLanding();
}

['mode', 'source', 'level', 'chroma', 'floor', 'vol', 'duty', 'field',
 'audio', 'aDuty', 'aDepth', 'aTilt', 'aEmp', 'aCoh', 'aDrift']
  .forEach(id => $(id).addEventListener('input', refreshControls));

$('vol').addEventListener('input', () => {
  if (session && session.audio) session.audio.setVolume(Number($('vol').value));
});

$('musicFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  set('musicNote', 'decoding...', 'dim');
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    musicBuffer = await ctx.decodeAudioData(await f.arrayBuffer());
    ctx.close();
    set('musicNote', `${f.name}  ${musicBuffer.duration.toFixed(1)}s, ` +
        `${musicBuffer.numberOfChannels} ch, ${musicBuffer.sampleRate} Hz`, 'ok');
    renderDefaults();
  } catch (err) {
    musicBuffer = null;
    set('musicNote', "couldn't read that file: " + err.message, 'bad');
  }
});

/* ------------------------------------------------------------- settings */

/* Settings survive a reload in localStorage. Only what the user changed is kept, so a default we improve later still
 * reaches them. Every github.io project shares one origin, so the key carries a prefix.
 */
const STORE = '40hz:settings';
const settingControls = () => [...$('configPane').querySelectorAll('input:not([type=file]), select')];
const defaultOf = el => el.tagName === 'SELECT'
  ? ([...el.options].find(o => o.defaultSelected) || el.options[0] || {}).value
  : el.type === 'checkbox' ? el.defaultChecked : el.defaultValue;
const valueOf = el => el.type === 'checkbox' ? el.checked : el.value;
// Sliders compare as numbers: the markup says 0.30 and the slider reports 0.3.
const changed = el => el.type === 'range'
  ? Number(el.value) !== Number(el.defaultValue) : valueOf(el) !== defaultOf(el);

function storedSettings() {
  try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; }
}

function saveSettings() {
  const prev = storedSettings(), values = {};
  for (const el of settingControls()) {
    if (el.id === 'duty') continue;
    // Level is auto-picked per device, so it's only kept once the user has set it, even back to 1.
    if (el.id === 'level' ? levelTouched : changed(el)) values[el.id] = valueOf(el);
  }
  // On-time counts frames, which only means the same thing at the same refresh. A choice made on another screen
  // is carried along untouched.
  const duty = $('duty');
  if (caps.measured && caps.eligible && duty.value !== defaultOf(duty)) {
    Object.assign(values, { duty: duty.value, dutyFpc: caps.framesPerCycle });
  } else if (prev.duty && prev.dutyFpc !== caps.framesPerCycle) {
    Object.assign(values, { duty: prev.duty, dutyFpc: prev.dutyFpc });
  }
  try {
    if (Object.keys(values).length) localStorage.setItem(STORE, JSON.stringify(values));
    else localStorage.removeItem(STORE);
  } catch {}                                            // storage blocked, settings just won't stick
}

function restoreSettings() {
  const saved = storedSettings();
  for (const el of settingControls()) {
    if (!(el.id in saved) || el.id === 'duty') continue;
    // A music file can't be stored, and music mode with no file is silence.
    if (el.id === 'audio' && saved.audio === 'music') continue;
    if (el.type === 'checkbox') el.checked = !!saved[el.id];
    else if (el.tagName !== 'SELECT' || [...el.options].some(o => o.value === saved[el.id])) el.value = saved[el.id];
  }
  if ('level' in saved) levelTouched = true;
}

/* Runs after the refresh measurement builds the on-time options. */
function restoreDuty() {
  const saved = storedSettings(), duty = $('duty');
  if (saved.dutyFpc === caps.framesPerCycle && [...duty.options].some(o => o.value === saved.duty)) {
    duty.value = saved.duty;
  }
}

for (const type of ['input', 'change']) {
  $('configPane').addEventListener(type, () => { saveSettings(); renderDefaults(); });
}

/* Where each default sits: a tick under every slider and "(default)" on every dropdown's default option. Reset only
 * shows when there's something to reset. */
function markDefaults() {
  for (const el of settingControls()) {
    if (el.tagName === 'SELECT') {
      const def = el.options.length > 1 ? defaultOf(el) : null;
      for (const o of el.options) {
        const base = o.dataset.label || (o.dataset.label = o.textContent);
        o.textContent = o.value === def ? `${base} (default)` : base;
      }
    } else if (el.type === 'range') {
      let tick = el.nextElementSibling;
      if (!el.parentElement.classList.contains('range-wrap')) {
        const wrap = document.createElement('div');
        wrap.className = 'range-wrap';
        el.replaceWith(wrap);
        tick = document.createElement('span');
        tick.className = 'default-tick';
        wrap.append(el, tick);
      }
      const d = el.id === 'level' ? (autoLevel() ?? Number(el.defaultValue)) : Number(el.defaultValue);
      tick.style.setProperty('--at', String((d - el.min) / (el.max - el.min)));
    }
  }
}
function anyChanged() {
  return !!musicBuffer || settingControls().some(el => el.id === 'level' ? levelTouched
    : el.id === 'duty' ? caps.measured && el.options.length > 1 && el.value !== defaultOf(el)
    : changed(el));
}
function renderDefaults() {
  markDefaults();
  $('resetSettings').hidden = !anyChanged();
}

/* Back to what the page ships with, and forget what was stored. Level and on-time then re-derive from this device,
 * same as on a first visit. */
$('resetSettings').addEventListener('click', () => {
  for (const el of $('configPane').querySelectorAll('input, select')) {
    if (el.tagName === 'SELECT') el.selectedIndex = Math.max(0, [...el.options].findIndex(o => o.defaultSelected));
    else if (el.type === 'checkbox') el.checked = el.defaultChecked;
    else el.value = el.type === 'file' ? '' : el.defaultValue;
  }
  try { localStorage.removeItem(STORE); } catch {}
  musicBuffer = null;
  set('musicNote', 'none loaded', 'dim');
  levelTouched = false;
  applyAutoLevel();
  refreshControls();
});

$('remeasure').onclick = measure;
$('start').onclick = () => beginSession({ light: true });
$('lightOff').onclick = () => beginSession({ light: false });

$('stage').addEventListener('click', () => endSession('stopped'));
addEventListener('resize', applyField);

/* Field size, live. A smaller field is less of the screen repainted 120 times a second, which can steady a device
 * that stutters. */
function fieldPx() {
  const f = Number($('field').value);
  return [Math.round(innerWidth * f), Math.round(innerHeight * f)];
}
function applyField() {
  if (!session) return;
  const [w, h] = fieldPx();
  if (session.field) session.field.resize(w, h);
  if (session.video) { session.video.style.width = w + 'px'; session.video.style.height = h + 'px'; }
  $('sizeV').textContent = Math.round(Number($('field').value) * 100) + '%';
}
function stepField(dir) {
  const el = $('field');
  el.value = String(Math.round((Number(el.value) + dir * 0.1) * 10) / 10);   // the range clamps and snaps it
  refreshControls();
  saveSettings();
  applyField();
}

/* The cursor and the size buttons show while the mouse moves and fade after a few still seconds. Touch has no hover,
 * so there they stay up with the hint for the first 30 s, and a tap anywhere else still stops. */
const TOUCH = () => matchMedia('(hover: none)').matches;
let idleTimer = 0;
function wake(ms) {
  $('stage').classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => $('stage').classList.add('idle'), ms);
}
$('stage').addEventListener('pointermove', e => { if (session && e.pointerType === 'mouse') wake(2500); });
for (const [id, dir] of [['sizeDown', -1], ['sizeUp', 1]]) {
  $(id).addEventListener('click', e => {
    e.stopPropagation();                         // a click on the stage itself stops the session
    stepField(dir);
    wake(TOUCH() ? 30000 : 2500);
  });
}
addEventListener('keydown', e => {
  if (!session) return;
  if (e.key === 'Escape') endSession('stopped');
  else if (e.key === '+' || e.key === '=') stepField(1);
  else if (e.key === '-' || e.key === '_') stepField(-1);
  else if (e.key === 's' || e.key === 'S') { $('hud').hidden = !$('hud').hidden; hideHint(); }
});
// Escape inside fullscreen exits fullscreen without always firing keydown, so catch that too.
// Only a session that actually went fullscreen ends when fullscreen ends. Exiting is async, so the
// previous session's exit event can land after a quick restart and would otherwise kill the new one.
addEventListener('fullscreenchange', () => {
  if (!session) return;
  if (document.fullscreenElement) session.wentFullscreen = true;
  else if (session.wentFullscreen) endSession('stopped');
});

/* --------------------------------------------------------------- startup */

restoreSettings();
refreshControls();
probeStatic();
probeGpu().then(g => { caps.gpu = g; renderVerdict(); applyAutoLevel(); refreshControls(); });
// A web font swapping in mid-sample forces a relayout, and the late frames it causes would read as a
// slow display. So the refresh sample waits for type to settle, and the carrier waits for the sample.
(document.fonts ? document.fonts.ready : Promise.resolve()).then(measure).then(prebuildCarrier);
