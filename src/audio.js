/**
 * Sound, generated in code.
 *
 * There are no audio files in this project. Every sound is synthesised from
 * noise and oscillators at runtime — nothing to download, nothing to license,
 * and no two megabytes of MP3 attached to a page someone looks at for forty
 * seconds. It is also the more interesting problem.
 *
 * Voices:
 *   - rolling:   a stream of contact grains, rated and pitched by speed
 *   - knock:     a filtered burst on impact, pitched by how hard
 *   - land:      a knock with a low body under it, so it is not a rock
 *   - jump:      a fast rising blip, the opposite gesture to an impact
 *   - chime:     one note per monument, climbing a pentatonic run
 *   - swell:     a slow chord under the dawn
 *   - threshold: a tick when you cross into a monument's ring
 *
 * They share a reverb built from an impulse response generated here, which
 * opens up as dawn breaks: night sounds small and close, morning sounds open.
 *
 * Browsers will not start audio until the user has interacted with the page,
 * so nothing is built until start() is called from a real gesture.
 */

const MASTER = 0.9;
const STORE_KEY = "orrery.sound";

/** A pentatonic run. Any four of these in order sound like progress. */
const CHIME_HZ = [329.63, 392.0, 493.88, 587.33, 783.99];

/** Root chord for the dawn swell — a warm open fifth with an added ninth. */
const SWELL_HZ = [98.0, 146.83, 220.0, 329.63];

/**
 * How much of each voice goes to the room.
 *
 * The roll is almost dry on purpose. A wet rolling sound is a marble in a
 * bathroom, not a marble on a planet — reverb belongs on the events, not on
 * the continuous bed underneath them.
 */
const SEND = {
  chime: 0.55, swell: 0.7, knock: 0.18,
  land: 0.22, jump: 0.2, tick: 0.4, roll: 0.05,
};

function readStoredMute() {
  try {
    // Default is sound ON, but nothing is built until a gesture, so nobody is
    // ambushed either way. Only an explicit previous "off" mutes.
    return localStorage.getItem(STORE_KEY) === "off";
  } catch {
    return false;
  }
}

/**
 * A room, built from arithmetic.
 *
 * Sparse early reflections first — the part of a reverb that actually tells
 * you the size of a space — then a diffuse tail. Early times are jittered
 * independently per channel, and that *is* the stereo width: no decorrelation
 * trick is needed, because the two channels genuinely describe different paths.
 *
 * A one-pole lowpass then runs over the result with a coefficient that itself
 * decays, so high frequencies die before low ones. That is air absorption, and
 * it is most of the difference between a reverb that sounds like a place and
 * one that sounds like a delay line.
 */
function buildImpulse(ctx, seconds, channels) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(channels, n, sr);

  for (let ch = 0; ch < channels; ch++) {
    const d = buf.getChannelData(ch);

    for (let i = 0; i < 40; i++) {
      const t = 0.008 + Math.random() * 0.082;
      const idx = Math.floor(t * sr);
      if (idx >= n) continue;
      // Alternating sign keeps the cluster from summing into one thud.
      d[idx] += (i % 2 ? -1 : 1) * 0.9 * Math.exp(-t / 0.045);
    }

    const from = Math.floor(0.04 * sr);
    for (let i = from; i < n; i++) {
      d[i] += (Math.random() * 2 - 1) * Math.exp(-(i / sr) / (seconds * 0.21));
    }

    let lp = 0;
    for (let i = 0; i < n; i++) {
      const a = 0.35 * Math.exp(-(i / sr) / 0.8) + 0.02;
      lp += a * (d[i] - lp);
      d[i] = lp;
    }

    // Normalised by hand because convolver.normalize is off — leaving it on
    // lets the palettes drift in loudness against each other for no reason a
    // listener could name.
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[i] * d[i];
    // Conservative: a convolution sums energy across the whole impulse, and
    // headroom is cheaper than discovering the master clips on a loud chime.
    const k = 0.09 / (Math.sqrt(sum / n) || 1);
    for (let i = 0; i < n; i++) d[i] *= k;
  }

  return buf;
}

/**
 * The rolling voice.
 *
 * A bed of filtered noise is what a rolling object sounds like only in the
 * sense that a photocopier sounds like rain. A real rolling contact is a rapid
 * stream of tiny impacts, so this bakes exactly that: 900 bursts of 1.6ms
 * noise scattered through 4.7 seconds, each with its own amplitude.
 *
 * Speed then drives playbackRate rather than gain, which moves the grain rate
 * and their pitch together — precisely how a rolling object behaves, and
 * something a filter sweep can only imitate. It also means the loop point
 * never lands the same way twice, because the rate is never constant.
 *
 * Density is the whole tuning problem: too dense and the grains fuse back into
 * the noise this exists to escape, too sparse and it machine-guns into clicks.
 * This sits above 150 grains a second at speed, where they fuse, and the
 * amplitude jitter carries the texture.
 */
function buildGrains(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 4.7);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);

  // 1.6ms, not 2. At 2ms and 1400 grains the buffer was 44% non-silent,
  // which is dense enough that the grains average back into the broadband
  // noise this exists to escape.
  const grainLen = Math.floor(0.0016 * sr);
  const tau = 0.0006 * sr;

  // ~190 grains a second at unity rate, ~290 at full speed. Comfortably
  // above the point where they fuse into a continuous contact, with enough
  // space between them that the amplitude jitter still reads as texture.
  for (let g = 0; g < 900; g++) {
    const start = Math.floor(Math.random() * (n - grainLen - 1));
    // +/-6dB of jitter. This is what stops it sounding synthetic.
    const amp = Math.pow(10, (Math.random() * 12 - 6) / 20) * 0.42;
    for (let i = 0; i < grainLen; i++) {
      d[start + i] += (Math.random() * 2 - 1) * Math.exp(-i / tau) * amp;
    }
  }
  return buf;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    // Read before start(), which builds the graph in whichever state this is.
    this.muted = readStoredMute();
    this._lastKnock = 0;
  }

  start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    const ctx = this.ctx;

    this._master = ctx.createGain();
    // Always start silent and fade up. Audio that cuts in at full level is
    // startling even when it was asked for.
    this._master.gain.value = 0;
    this._master.connect(ctx.destination);
    if (!this.muted) {
      this._master.gain.setTargetAtTime(MASTER, ctx.currentTime, 0.35);
    }

    /* ---- reverb ----
       A convolver is the most expensive node here and its cost scales with
       impulse length, so a weak device gets a shorter mono room. Audio
       glitching is far more noticeable than a dropped frame. */
    const weak = (navigator.hardwareConcurrency ?? 8) <= 4;
    this._verbIn = ctx.createGain();
    this._damp = ctx.createBiquadFilter();
    this._damp.type = "lowpass";
    this._damp.frequency.value = 1800;
    this._convolver = ctx.createConvolver();
    this._convolver.normalize = false;
    this._convolver.buffer = buildImpulse(ctx, weak ? 1.3 : 2.6, weak ? 1 : 2);
    this._wet = ctx.createGain();
    this._wet.gain.value = 0.25;
    this._verbIn
      .connect(this._damp)
      .connect(this._convolver)
      .connect(this._wet)
      .connect(this._master);

    /* ---- rolling: grains ---- */
    const src = ctx.createBufferSource();
    src.buffer = buildGrains(ctx);
    src.loop = true;
    this._rollSrc = src;

    // Cut the sub. Below ~110Hz a phone reproduces nothing but cone flap, and
    // on headphones it only muddies what sits above it.
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 115;

    this._rollFilter = ctx.createBiquadFilter();
    this._rollFilter.type = "lowpass";
    this._rollFilter.frequency.value = 420;
    this._rollFilter.Q.value = 0.7;

    this._rollGain = ctx.createGain();
    this._rollGain.gain.value = 0;

    src.connect(hp).connect(this._rollFilter).connect(this._rollGain);
    this._route(this._rollGain, SEND.roll);
    src.start();

    /* ---- rolling: a quiet bed under the grains, for body ---- */
    const bedBuf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const bd = bedBuf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < bd.length; i++) {
      b0 = (b0 + 0.008 * (Math.random() * 2 - 1)) / 1.008;
      bd[i] = b0 * 26;
    }
    const bed = ctx.createBufferSource();
    bed.buffer = bedBuf;
    bed.loop = true;
    bed.playbackRate.value = 0.87;
    const bedLp = ctx.createBiquadFilter();
    bedLp.type = "lowpass";
    bedLp.frequency.value = 320;
    this._bedGain = ctx.createGain();
    this._bedGain.gain.value = 0;
    bed.connect(bedLp).connect(this._bedGain);
    this._route(this._bedGain, 0);
    bed.start();

    this.ready = true;
  }

  /** Dry to master, plus a send to the room. */
  _route(node, send) {
    node.connect(this._master);
    if (send > 0 && this._verbIn) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      node.connect(s).connect(this._verbIn);
    }
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(STORE_KEY, m ? "off" : "on");
    } catch { /* private mode; the choice just will not persist */ }
    if (this._master) {
      this._master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.06);
    }
  }

  /**
   * Park the context when the tab is hidden. A background tab making noise is
   * the fastest way to get a page closed and never reopened.
   */
  setPageVisible(visible) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (!visible) {
      this._master.gain.setTargetAtTime(0, t, 0.12);
      this._suspendTimer = setTimeout(() => this.ctx.suspend().catch(() => {}), 320);
      return;
    }
    clearTimeout(this._suspendTimer);
    this.ctx.resume().catch(() => {});
    if (!this.muted) this._master.gain.setTargetAtTime(MASTER, t, 0.25);
  }

  /**
   * Whether sound is genuinely audible right now.
   *
   * iOS refuses resume() outside a gesture fairly often, and ignores it
   * entirely while the hardware mute switch is on. The context's own state is
   * the only honest signal — an unmuted speaker icon over a suspended context
   * is the UI lying.
   */
  get audible() {
    return this.ready && !this.muted && this.ctx?.state === "running";
  }

  /** The room opens as morning arrives: wetter, and much brighter. */
  setDawn(d) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._wet.gain.setTargetAtTime(0.25 + 0.25 * d, t, 0.6);
    this._damp.frequency.setTargetAtTime(1800 + 4700 * d, t, 0.8);
  }

  /**
   * @param {number} speed     current speed
   * @param {number} maxSpeed  for normalisation
   * @param {boolean} grounded silence the roll mid-air; a marble in flight
   *                           makes no noise, and hearing it is uncanny
   * @param {number} slope     0 on the flat, ~0.25 on the steepest relief
   */
  updateRoll(speed, maxSpeed, grounded, slope = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = grounded ? Math.min(1, speed / maxSpeed) : 0;

    // Fast out, slow in. Silence on a jump should land as an event; coming
    // back to the ground should not click.
    const tc = n === 0 ? 0.012 : 0.09;

    this._rollGain.gain.setTargetAtTime(n * n * 0.5, t, tc);
    this._bedGain.gain.setTargetAtTime(n * n * 0.18, t, tc);

    // Rate, not gain. Moving grain rate and grain pitch together is what a
    // rolling object actually does; a filter sweep can only imitate it.
    this._rollSrc.playbackRate.setTargetAtTime(0.55 + 0.95 * n, t, 0.06);

    this._rollFilter.frequency.setTargetAtTime(320 + n * 900, t, 0.09);
    // Steeper ground rings more: a marble crossing a slope loads against the
    // surface differently from one running flat.
    this._rollFilter.Q.setTargetAtTime(0.7 + slope * 6, t, 0.1);
  }

  /** A knock. `strength` is the normal velocity of the impact. */
  knock(strength) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Rate limit. A marble resting against a rock generates a contact every
    // frame, and without this it machine-guns.
    if (t - this._lastKnock < 0.06) return;
    this._lastKnock = t;

    const amp = Math.min(1, strength / 12);
    if (amp < 0.06) return;

    const len = 0.14;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      // Exponential decay envelope baked into the buffer.
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    // Harder impacts ring higher, the way a struck object actually behaves.
    bp.frequency.value = 220 + amp * 700;
    bp.Q.value = 1.6;

    const g = ctx.createGain();
    g.gain.value = amp * 0.5;

    src.connect(bp).connect(g);
    this._route(g, SEND.knock);
    src.start(t);
    src.stop(t + len);
  }

  /**
   * Leaving the ground. A short rising blip.
   *
   * Jump and impact used to fire literally the same call, so pushing off
   * sounded exactly like hitting something — the two moments in the piece that
   * most need to feel opposite.
   */
  jump() {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(190, t);
    // Rising, and fast. A slow sweep sounds like a cartoon.
    osc.frequency.exponentialRampToValueAtTime(430, t + 0.11);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);

    osc.connect(g);
    this._route(g, SEND.jump);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  /** Coming back down: a knock with a low body under it. */
  land(strength) {
    if (!this.ready || this.muted) return;
    this.knock(strength * 0.85);

    const ctx = this.ctx;
    const t = ctx.currentTime;
    const amp = Math.min(1, strength / 14);
    if (amp < 0.12) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(120 + amp * 40, t);
    osc.frequency.exponentialRampToValueAtTime(58, t + 0.16);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);

    osc.connect(g);
    this._route(g, SEND.land);
    osc.start(t);
    osc.stop(t + 0.33);
  }

  /**
   * Crossing into a monument's ring. Deliberately tiny — it confirms the
   * boundary without competing with the chime a moment later.
   */
  threshold() {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 1180;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);

    osc.connect(g);
    this._route(g, SEND.tick);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** One note per monument, climbing. `index` is 0-based. */
  chime(index) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const hz = CHIME_HZ[Math.min(index, CHIME_HZ.length - 1)];

    // Two partials: the fundamental plus a quiet octave-and-a-fifth. Cheaper
    // than a real bell model and enough to stop it sounding like a test tone.
    [[hz, 0.34, 2.6], [hz * 3, 0.07, 1.5]].forEach(([f, gain, dur]) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g);
      this._route(g, SEND.chime);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    });
  }

  /** The chord under the dawn. Slow in, slow out, never repeats. */
  swell(seconds = 9) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    SWELL_HZ.forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = f;
      // A little detune keeps four oscillators from phasing into one flat tone.
      osc.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 / (i + 1), t + 2.2);
      g.gain.setValueAtTime(0.16 / (i + 1), t + seconds * 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      osc.connect(g);
      this._route(g, SEND.swell);
      osc.start(t);
      osc.stop(t + seconds + 0.1);
    });
  }
}
