/**
 * Sound, generated in code.
 *
 * There are no audio files in this project. Every sound here is synthesised
 * from noise and oscillators at runtime, which means nothing to download,
 * nothing to license, and no 2MB of MP3 for a page someone looks at for forty
 * seconds. It is also the more interesting problem.
 *
 * Three voices:
 *   - a rolling loop: filtered noise whose brightness and volume track speed
 *   - a knock: short filtered burst on each impact, pitched by how hard
 *   - a chime: one note per monument lit, climbing a pentatonic scale
 *   - a swell: a slow chord under the dawn
 *
 * Browsers will not start audio until the user has interacted with the page,
 * so nothing is built until `start()` is called from a real input event.
 */

/** A pentatonic run. Any four of these in order sound like progress. */
const CHIME_HZ = [329.63, 392.0, 493.88, 587.33, 783.99];

/** Root chord for the dawn swell — a warm open fifth with an added ninth. */
const SWELL_HZ = [98.0, 146.83, 220.0, 329.63];

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this._rollGain = null;
    this._rollFilter = null;
    this._master = null;
    this._swellGain = null;
    this._lastKnock = 0;
  }

  /**
   * Build the graph. Must be called from inside a user gesture, or the context
   * starts suspended and every later sound is silently dropped.
   */
  start() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    const ctx = this.ctx;

    this._master = ctx.createGain();
    this._master.gain.value = this.muted ? 0 : 0.9;
    this._master.connect(ctx.destination);

    /* ---- rolling loop ----
       A looping buffer of white noise, run through a lowpass. Speed opens the
       filter and raises the gain, so faster reads as brighter and louder
       rather than merely louder — which is what a real rolling object does. */
    const seconds = 3;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < data.length; i++) {
      // Heavily integrated noise. The first version used a light integration
      // and opened the filter to 1.6kHz, which is a recipe for wind: on a
      // phone speaker the low end simply is not reproduced, so all that
      // reached the listener was the hiss.
      b0 = (b0 + 0.008 * (Math.random() * 2 - 1)) / 1.008;
      data[i] = b0 * 26;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Detune the loop slightly off unity so the 3-second seam does not land on
    // a predictable beat.
    src.playbackRate.value = 0.87;

    // Cut the sub. Below ~110Hz a phone reproduces nothing but cone flap, and
    // on headphones it just muddies everything above it.
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 115;

    this._rollFilter = ctx.createBiquadFilter();
    this._rollFilter.type = "lowpass";
    this._rollFilter.frequency.value = 160;
    // A little resonance gives the noise a centre to sit on, so it reads as an
    // object with a size rather than as broadband hiss.
    this._rollFilter.Q.value = 1.7;

    this._rollGain = ctx.createGain();
    this._rollGain.gain.value = 0;

    src.connect(hp).connect(this._rollFilter).connect(this._rollGain).connect(this._master);
    src.start();

    /* ---- dawn swell bus ---- */
    this._swellGain = ctx.createGain();
    this._swellGain.gain.value = 0;
    this._swellGain.connect(this._master);

    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    if (this._master) {
      this._master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
    }
  }

  /**
   * @param {number} speed     current speed
   * @param {number} maxSpeed  for normalisation
   * @param {boolean} grounded silence the roll mid-air; a marble in flight
   *                           makes no noise, and hearing it is uncanny
   */
  updateRoll(speed, maxSpeed, grounded) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = grounded ? Math.min(1, speed / maxSpeed) : 0;
    // Curved, not linear: a marble at half speed is much quieter than half.
    // The ceiling is a third of what it was — this is a bed the other sounds
    // sit on, and it was loud enough to be the main event.
    this._rollGain.gain.setTargetAtTime(n * n * 0.17, t, 0.09);
    // Tops out under 700Hz. Above that it stops sounding like a heavy object
    // on stone and starts sounding like static.
    this._rollFilter.frequency.setTargetAtTime(150 + n * 520, t, 0.09);
  }

  /**
   * A knock. `strength` is the normal velocity of the impact.
   */
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

    src.connect(bp).connect(g).connect(this._master);
    src.start(t);
    src.stop(t + len);
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
      osc.connect(g).connect(this._master);
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
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 / (i + 1), t + 2.2);
      g.gain.setValueAtTime(0.16 / (i + 1), t + seconds * 0.55);
      g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
      osc.connect(g).connect(this._swellGain);
      osc.start(t);
      osc.stop(t + seconds + 0.1);
    });

    this._swellGain.gain.setTargetAtTime(1, t, 0.5);
  }
}
