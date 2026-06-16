/**
 * Tower-Defense procedural sound engine — fully self-contained, no audio files,
 * no imports. Every effect is synthesized live with the Web Audio API, so it
 * ships with zero assets and works offline.
 *
 * The palette is deliberately COZY: short, soft, slightly lo-fi blips and thuds
 * with quick decays and low per-voice gain. Towers can fire many shots per
 * second, so each play method is rate-limited and kept quiet enough that
 * overlaps stay pleasant rather than piling into harsh noise.
 *
 * Signal chain:  voices ─▶ master(gain) ─▶ softClip(compressor) ─▶ destination
 *
 * Browsers block audio before a user gesture; the context is therefore created
 * (and resumed) lazily on the first sound call. By the time TD plays a sound a
 * gesture has already happened, so this is safe.
 */

// ───────────────────────── tuning block ─────────────────────────
// Master mix level. Cozy = quiet; layered tower fire should never get loud.
const MASTER_VOLUME = 0.42;
// Soft-clip / glue compressor so dense waves of shots stay smooth, never harsh.
const COMP_THRESHOLD = -14; // dB where gentle limiting kicks in
const COMP_RATIO = 6; // moderate ratio — glue, not a brick wall
// Per-tower fire throttle (seconds). Ignore the SAME tower re-firing within this
// window so a screen full of towers doesn't stack into a buzz.
const FIRE_THROTTLE = 0.05; // ~50ms
// Generic throttles for the busier feedback sounds.
const IMPACT_THROTTLE = 0.03;
const LEAK_THROTTLE = 0.12;
// Default quick decay for the little blips (seconds).
const SHORT_DECAY = 0.08;
// Tiny detune variance (cents) so repeats don't fatigue the ear.
const DETUNE_CENTS = 35;

type Tower = "arrow" | "frost" | "cannon" | "sniper" | "pylon" | "tesla" | "venom";

/** Equal-tempered semitone ratio. */
function semi(n: number): number {
  return Math.pow(2, n / 12);
}

export class TdAudio {
  private ctx?: AudioContext;
  private master?: GainNode; // pre-comp mix bus
  // One pre-baked white-noise buffer, reused (looped from random offsets) by
  // every noise voice so we never allocate/fill a buffer per shot.
  private noiseBuf?: AudioBuffer;
  private enabled = true;
  // Per-tower last-fire timestamps (seconds) for the same-tower throttle.
  private lastFire: Record<Tower, number> = {
    arrow: 0,
    frost: 0,
    cannon: 0,
    sniper: 0,
    pylon: 0,
    tesla: 0,
    venom: 0,
  };
  private lastImpact = 0;
  private lastLeak = 0;

  constructor() {
    // Intentionally empty: the AudioContext is created lazily on first sound so
    // we never trip the browser autoplay policy before a user gesture.
  }

  /** Mute / unmute. Respected by every play method (default on). */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? MASTER_VOLUME : 0;
  }

  // ─────────────────────── lifecycle / helpers ───────────────────────

  /** Lazily create the context + master chain. Returns false if unavailable. */
  private ensure(): boolean {
    if (this.ctx) return true;
    try {
      const Ctor: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      const ctx = new Ctor();
      this.ctx = ctx;

      // Gentle glue/limiter so a wall of layered transients never clips harshly.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = COMP_THRESHOLD;
      comp.knee.value = 10;
      comp.ratio.value = COMP_RATIO;
      comp.attack.value = 0.004;
      comp.release.value = 0.16;
      comp.connect(ctx.destination);

      const master = ctx.createGain();
      master.gain.value = this.enabled ? MASTER_VOLUME : 0;
      master.connect(comp);
      this.master = master;

      // Pre-bake ~1s of white noise once; noise voices loop a random window of
      // it instead of generating fresh samples on every call.
      this.noiseBuf = this.makeNoise(1.0);
      return true;
    } catch {
      // No Web Audio available — the game simply runs silently.
      this.ctx = undefined;
      return false;
    }
  }

  /** Guard: enabled, context exists & not closed, resumed if suspended. */
  private ok(): boolean {
    if (!this.enabled) return false;
    if (!this.ensure()) return false;
    const ctx = this.ctx;
    if (!ctx || ctx.state === "closed" || !this.master) return false;
    if (ctx.state === "suspended") {
      // best-effort resume; ignore the returned promise/errors
      void ctx.resume().catch(() => {});
    }
    return true;
  }

  private get t(): number {
    return this.ctx!.currentTime;
  }

  /** Static mono white-noise buffer, reused across all noise voices. */
  private makeNoise(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Small random detune ratio (±cents) so repeated SFX don't fatigue. */
  private vary(cents = DETUNE_CENTS): number {
    return Math.pow(2, ((Math.random() - 0.5) * 2 * cents) / 1200);
  }

  /** A single oscillator voice with a fast attack + exponential decay. */
  private blip(
    type: OscillatorType,
    freq: number,
    dur: number,
    gain: number,
    opts: { sweepTo?: number; delay?: number; detune?: number } = {},
  ) {
    const ctx = this.ctx!;
    const start = this.t + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    if (opts.detune) osc.detune.value = opts.detune;
    osc.frequency.setValueAtTime(freq, start);
    if (opts.sweepTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), start + dur);
    }
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** Short burst of filtered noise — used for cracks, booms, shimmers. */
  private noise(
    dur: number,
    gain: number,
    filterType: BiquadFilterType,
    freq: number,
    q = 1,
    opts: { sweepTo?: number; delay?: number } = {},
  ) {
    const ctx = this.ctx!;
    const buf = this.noiseBuf;
    if (!buf) return;
    const start = this.t + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopEnd = buf.duration;
    const offset = Math.random() * buf.duration;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(freq, start);
    filt.Q.value = q;
    if (opts.sweepTo !== undefined) {
      filt.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), start + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filt);
    filt.connect(g);
    g.connect(this.master!);
    src.start(start, offset);
    src.stop(start + dur + 0.02);
  }

  /** A soft sine sub-thump — the body that makes booms/impacts feel weighty. */
  private sub(freq: number, dur: number, gain: number, delay = 0) {
    const ctx = this.ctx!;
    const start = this.t + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, freq * 0.45), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  // ─────────────────────────── tower fire ───────────────────────────

  /**
   * Per-tower shot. Same-tower repeats inside FIRE_THROTTLE are ignored so rapid
   * fire never piles up; per-call gain is kept low so overlaps stay pleasant.
   */
  fire(tower: Tower) {
    if (!this.ok()) return;
    const now = this.t;
    if (now - this.lastFire[tower] < FIRE_THROTTLE) return;
    this.lastFire[tower] = now;
    const v = this.vary();
    switch (tower) {
      case "arrow": {
        // soft pluck / twang — a quick down-sweeping triangle with a tick.
        this.blip("triangle", 660 * v, 0.11, 0.13, { sweepTo: 240 * v });
        this.noise(0.025, 0.07, "highpass", 2600, 0.6);
        break;
      }
      case "frost": {
        // airy shimmer — gentle high noise sweep + a bright bell overtone.
        this.noise(0.18, 0.05, "bandpass", 3200 * v, 4, { sweepTo: 5200 });
        this.blip("sine", 1760 * v, 0.16, 0.05);
        this.blip("triangle", 2640 * v, 0.12, 0.03, { delay: 0.02 });
        break;
      }
      case "cannon": {
        // low boom — filtered low noise + a sine thump. Softer than a real boom.
        this.noise(0.16, 0.2, "lowpass", 700, 1, { sweepTo: 90 });
        this.blip("sine", 120 * v, 0.16, 0.16, { sweepTo: 46 });
        this.sub(80, 0.14, 0.16);
        break;
      }
      case "sniper": {
        // sharp crack — bright noise transient + a fast high snap.
        this.noise(0.04, 0.22, "highpass", 3400, 0.6);
        this.blip("square", 900 * v, 0.05, 0.1, { sweepTo: 300 });
        this.sub(110, 0.07, 0.1);
        break;
      }
      case "pylon": {
        // soft blip / ping — a clean little sine (default quick decay) + glint a
        // perfect fifth above.
        this.blip("sine", 1320 * v, SHORT_DECAY, 0.1, { sweepTo: 980 });
        this.blip("triangle", 1320 * v * semi(7), 0.05, 0.025);
        break;
      }
      case "tesla": {
        // electric zap / crackle — buzzy square zap + a hot noise crackle.
        this.blip("square", 1500 * v, 0.06, 0.07, { sweepTo: 3000 });
        this.noise(0.05, 0.06, "highpass", 4200, 0.7);
        this.blip("sawtooth", 760 * v, 0.05, 0.04, { sweepTo: 1800 });
        break;
      }
      case "venom": {
        // wet hiss / bubble — a low filtered noise burst + a sour detuned blip.
        this.noise(0.12, 0.07, "bandpass", 900 * v, 3, { sweepTo: 400 });
        this.blip("triangle", 360 * v, 0.13, 0.05, { sweepTo: 220 });
        break;
      }
    }
  }

  // ─────────────────────── impacts & economy ────────────────────────

  /** A small thud/tick on enemy hit. `big` = a meatier crunch. */
  impact(big = false) {
    if (!this.ok()) return;
    const now = this.t;
    if (now - this.lastImpact < IMPACT_THROTTLE) return;
    this.lastImpact = now;
    const v = this.vary(45);
    if (big) {
      this.noise(0.1, 0.2, "lowpass", 900 * v, 1, { sweepTo: 140 });
      this.blip("triangle", 200 * v, 0.1, 0.12, { sweepTo: 70 });
      this.sub(70, 0.12, 0.16);
    } else {
      this.noise(0.03, 0.1, "bandpass", 1600 * v, 1.5);
      this.blip("triangle", 520 * v, 0.05, 0.08, { sweepTo: 300 });
    }
  }

  /** Satisfying placement chunk / clink when a tower is built. */
  build() {
    if (!this.ok()) return;
    // woody chunk + a bright metallic clink on top.
    this.noise(0.05, 0.14, "lowpass", 900, 1, { sweepTo: 200 });
    this.blip("triangle", 300, 0.09, 0.14, { sweepTo: 180 });
    this.blip("square", 1320, 0.06, 0.06, { delay: 0.03 });
    this.sub(90, 0.08, 0.12);
  }

  /** Rising sparkle when a tower is upgraded. */
  upgrade() {
    if (!this.ok()) return;
    const notes = [523, 659, 880, 1175];
    notes.forEach((n, i) => {
      this.blip("triangle", n, 0.12, 0.11, { delay: i * 0.05 });
      this.blip("square", n * 2, 0.05, 0.025, { delay: i * 0.05 }); // glint
    });
  }

  /** Soft descending blip when a tower is sold. */
  sell() {
    if (!this.ok()) return;
    this.blip("triangle", 740, 0.1, 0.12, { sweepTo: 440 });
    this.blip("sine", 440, 0.12, 0.07, { delay: 0.06, sweepTo: 300 });
  }

  // ────────────────────────── wave / base ───────────────────────────

  /** Worrying low warning when the base takes a leak. */
  leak() {
    if (!this.ok()) return;
    const now = this.t;
    if (now - this.lastLeak < LEAK_THROTTLE) return;
    this.lastLeak = now;
    // a sour two-tone dip — low, soft, a bit anxious.
    this.blip("sawtooth", 220, 0.22, 0.13, { sweepTo: 120 });
    this.blip("square", 165, 0.2, 0.07, { delay: 0.05, sweepTo: 98 });
    this.sub(60, 0.2, 0.12);
  }

  /** Wave-start horn / chime. `boss` = lower + ominous. */
  waveStart(boss = false) {
    if (!this.ok()) return;
    if (boss) {
      // ominous low horn swell with a minor-ish detuned body.
      const chord = [98, 117, 147]; // low, slightly tense stack
      chord.forEach((n, i) => {
        this.blip("sawtooth", n, 0.6, 0.1, { delay: i * 0.02, detune: -7 });
        this.blip("sawtooth", n, 0.6, 0.08, { delay: i * 0.02, detune: 7 });
      });
      this.noise(0.6, 0.05, "lowpass", 300, 1);
      this.sub(49, 0.6, 0.18);
    } else {
      // bright, friendly rising chime.
      const notes = [392, 523, 659];
      notes.forEach((n, i) => {
        this.blip("triangle", n, 0.3, 0.13, { delay: i * 0.1 });
        this.blip("square", n * 2, 0.12, 0.035, { delay: i * 0.1 });
      });
      this.sub(98, 0.3, 0.1);
    }
  }

  // ─────────────────────────── win / lose ───────────────────────────

  /** Short happy arpeggio on victory. */
  win() {
    if (!this.ok()) return;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((n, i) => {
      this.blip("triangle", n, 0.2, 0.13, { delay: i * 0.08 });
      this.blip("square", n * 2, 0.09, 0.04, { delay: i * 0.08 });
    });
    this.sub(131, 0.3, 0.12, 0.08);
  }

  /** Soft descending sad tone on defeat. */
  lose() {
    if (!this.ok()) return;
    const notes = [523, 415, 330, 262];
    notes.forEach((n, i) => {
      this.blip("triangle", n, 0.3, 0.13, { delay: i * 0.12 });
      this.blip("sine", n / 2, 0.34, 0.06, { delay: i * 0.12 });
    });
    this.sub(98, 0.5, 0.12, 0.36);
  }
}
