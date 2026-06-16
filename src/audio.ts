/**
 * Procedural sound engine — no audio files, no dependencies. Every effect is
 * synthesized live with the Web Audio API, so it ships with zero assets and
 * works offline. Sounds are intentionally short, punchy, and slightly
 * randomized so the constant gunfire/kills don't turn into a monotone buzz.
 *
 * Signal chain:  voices ─▶ master(gain) ─▶ limiter(compressor) ─▶ destination
 *                rewarding voices also tap a subtle procedural reverb send.
 *
 * Browsers block audio until the first user gesture, so `unlock()` is wired to
 * the first click/keypress and resumes the context.
 */
/** Max semitones the combo ladder climbs (≈ one octave) before plateauing. */
const COMBO_PITCH_CAP = 12;

export class Audio {
  private ctx?: AudioContext;
  private master?: GainNode; // pre-limiter mix bus (kept public-equivalent for setEnabled)
  private limiter?: DynamicsCompressorNode; // glue/limiter so layered hits never clip harshly
  private musicGain?: GainNode;
  private reverb?: ConvolverNode; // procedural space
  private reverbSend?: GainNode; // post-reverb level into the limiter
  // Pre-generated static white-noise buffers, reused by every noise() voice
  // (filter + playbackRate vary the timbre) so we never allocate/fill a buffer
  // per gunshot/hit/explosion. Two ~1s mono buffers picked round-robin.
  private noiseBufs: AudioBuffer[] = [];
  private noisePick = 0;
  private unlocked = false;
  private lastGunAt = 0;
  private lastGroanAt = 0;
  private lastHitAt = 0;
  private lastKillAt = 0;
  private lastBoomAt = 0;
  private lastAbilityAt = 0;
  private lastAbilityKind = "";
  // Rising-pitch combo ladder: each consecutive kill nudges the kill/hit tone up
  // a semitone (capped) for a dopamine-y ascending streak; reset on combo break.
  private comboSemis = 0;
  private musicOsc: OscillatorNode[] = [];
  private musicTimer?: number;
  enabled = true;

  /** Create the context lazily on first gesture (autoplay policy). */
  unlock() {
    if (this.unlocked) return;
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new Ctor();
      const ctx = this.ctx!;

      // Limiter / glue compressor sits just before the speakers. With lots of
      // layered transients (auto-fire + explosions + abilities) this keeps the
      // mix loud and punchy without nasty digital clipping.
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -10;
      this.limiter.knee.value = 8;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.18;
      this.limiter.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.limiter);

      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = 0.0;
      this.musicGain.connect(this.master);

      // Procedural reverb: a short, exponentially-decaying noise impulse fed to
      // a convolver. Only rewarding/impactful sounds tap it (see reverbSend).
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.makeImpulse(0.6, 2.6);
      this.reverbSend = ctx.createGain();
      this.reverbSend.gain.value = 0.9;
      this.reverb.connect(this.reverbSend);
      this.reverbSend.connect(this.limiter); // wet path bypasses master so it's stable

      // Pre-bake two seconds of white noise once; noise() slices a random
      // window of these instead of generating fresh samples on every shot.
      this.noiseBufs = [this.makeNoise(1.0), this.makeNoise(1.0)];
      this.unlocked = true;
    } catch {
      /* no audio available — game still runs silently */
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.6 : 0;
  }

  private get t(): number {
    return this.ctx!.currentTime;
  }

  private ok(): boolean {
    if (!this.enabled || !this.ctx || !this.master) return false;
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  /** Build a stereo decaying-noise impulse response for the convolver. */
  private makeImpulse(dur: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(2, frames, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < frames; i++) {
        const env = Math.pow(1 - i / frames, decay);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  /** Build a static mono white-noise buffer (reused across all noise voices). */
  private makeNoise(dur: number): AudioBuffer {
    const ctx = this.ctx!;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Equal-tempered pitch ratio for `n` semitones (memo-free, cheap). */
  private semi(n: number): number {
    return Math.pow(2, n / 12);
  }

  /** Small random pitch detune (±`cents`) so repeated SFX don't fatigue. */
  private vary(cents = 40): number {
    return Math.pow(2, ((Math.random() - 0.5) * 2 * cents) / 1200);
  }

  /** A single oscillator voice with an ADSR-ish gain envelope. */
  private blip(
    type: OscillatorType,
    freq: number,
    dur: number,
    gain: number,
    opts: { sweepTo?: number; delay?: number; dest?: AudioNode; detune?: number; pan?: number } = {},
  ) {
    const ctx = this.ctx!;
    const start = this.t + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    if (opts.detune) osc.detune.value = opts.detune;
    osc.frequency.setValueAtTime(freq, start);
    if (opts.sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    this.route(g, opts.dest, opts.pan, start);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /** Short burst of filtered noise — used for gunfire/explosions/groans. */
  private noise(
    dur: number,
    gain: number,
    filterType: BiquadFilterType,
    freq: number,
    q = 1,
    sweepTo?: number,
    opts: { dest?: AudioNode; pan?: number; delay?: number } = {},
  ) {
    const ctx = this.ctx!;
    const start = this.t + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    // Reuse a pre-baked static noise buffer (round-robin between the two) and
    // loop it from a random offset so every shot still sounds fresh/random,
    // without allocating + filling a buffer per call.
    const buf = this.noiseBufs[this.noisePick++ % this.noiseBufs.length] ?? this.makeNoise(dur);
    src.buffer = buf;
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buf.duration;
    const offset = Math.random() * buf.duration;
    const filt = ctx.createBiquadFilter();
    filt.type = filterType;
    filt.frequency.setValueAtTime(freq, start);
    filt.Q.value = q;
    if (sweepTo !== undefined) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filt);
    filt.connect(g);
    this.route(g, opts.dest, opts.pan, start);
    src.start(start, offset);
    src.stop(start + dur + 0.02);
  }

  /** A deep sub-bass thump — the body that makes kills/booms feel weighty. */
  private sub(freq: number, dur: number, gain: number, dest?: AudioNode) {
    const ctx = this.ctx!;
    const start = this.t;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(18, freq * 0.4), start + dur);
    // fast attack click + long-ish body for a satisfying "thud"
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g);
    g.connect(dest ?? this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  /**
   * Route a source through an optional StereoPanner into a destination.
   * Centralizes mono-safe panning so any voice can get a little spatial spread.
   */
  private route(node: AudioNode, dest?: AudioNode, pan?: number, start = this.t) {
    const target = dest ?? this.master!;
    // feature-detect (older Safari/WebKit lacks createStereoPanner); cast keeps
    // strict-mode tsc happy since the method type is otherwise always-defined.
    if (pan !== undefined && typeof (this.ctx as any).createStereoPanner === "function") {
      const p = this.ctx!.createStereoPanner();
      p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), start);
      node.connect(p);
      p.connect(target);
    } else {
      node.connect(target);
    }
  }

  /** Tap the reverb send at a given wet amount (reserved for rewarding sounds). */
  private wet(amount = 0.25): GainNode | undefined {
    if (!this.reverb) return undefined;
    const send = this.ctx!.createGain();
    send.gain.value = amount;
    send.connect(this.reverb);
    return send;
  }

  // ---- gameplay sounds ----

  /** Weapon shot. `tone` shifts timbre for different guns (0..1). */
  shoot(tone = 0.5) {
    if (!this.ok()) return;
    // rate-limit so auto weapons don't spawn dozens of nodes per frame
    if (this.t - this.lastGunAt < 0.03) return;
    this.lastGunAt = this.t;
    const base = 220 + tone * 180;
    const pan = (Math.random() - 0.5) * 0.4;
    // crisp transient crack + short body + a touch of sub for punch
    this.noise(0.05, 0.4, "highpass", 1400 + tone * 800, 0.6, undefined, { pan });
    this.noise(0.09, 0.3, "bandpass", 800 + tone * 600, 0.8, undefined, { pan });
    this.blip("square", base * (0.95 + Math.random() * 0.1), 0.07, 0.12, { sweepTo: base * 0.35, pan });
    this.sub(120 + tone * 40, 0.06, 0.12);
  }

  /**
   * Tell the engine the current combo length so the kill/hit ladder pitches up
   * one semitone per consecutive kill (capped). Pass 0 to break the streak. The
   * step is read by `hit()`/`kill()`; main.ts calls this at the kill sites.
   */
  comboStep(n: number) {
    this.comboSemis = Math.max(0, Math.min(COMBO_PITCH_CAP, Math.floor(n)));
  }

  /** Confirms a bullet connected — crisp tick. `crit` for headshots. */
  hit(crit = false) {
    if (!this.ok()) return;
    // Throttle: AoE (explosive/splash/chain) can fire many hits per frame —
    // creating an audio node each would jank the main thread.
    if (this.t - this.lastHitAt < 0.02) return;
    this.lastHitAt = this.t;
    const pan = (Math.random() - 0.5) * 0.5;
    // ±variance + the rising combo-semitone ladder so streaks ascend musically.
    const v = this.vary() * this.semi(this.comboSemis);
    this.blip("triangle", (crit ? 1500 : 920) * v, 0.05, crit ? 0.22 : 0.14, { sweepTo: (crit ? 720 : 500) * v, pan });
    // tiny noise click sharpens the transient
    this.noise(0.02, crit ? 0.16 : 0.1, "highpass", crit ? 3500 : 2600, 0.7, undefined, { pan });
    if (crit) this.blip("sine", 2400 * this.vary(), 0.04, 0.06, { pan }); // bright ping for headshots
  }

  /** Zombie dies. */
  kill() {
    if (!this.ok()) return;
    // Throttle: explosive/nuke/detonate can kill dozens in one frame; each kill
    // allocates a noise buffer + oscillator, so cap the rate to avoid FPS drops.
    if (this.t - this.lastKillAt < 0.04) return;
    this.lastKillAt = this.t;
    const pan = (Math.random() - 0.5) * 0.5;
    // ±variance plus the rising combo-semitone ladder (set via comboStep()).
    const v = this.vary(55) * this.semi(this.comboSemis);
    this.noise(0.16, 0.24, "lowpass", 600 * v, 1, 120 * v, { pan });
    this.blip("sawtooth", 160 * v, 0.16, 0.12, { sweepTo: 55 * v, pan });
    this.sub(150 * v, 0.14, 0.18); // squishy sub-thump body
  }

  /** Ambient zombie groan, rate-limited + pitch-varied. */
  groan() {
    if (!this.ok()) return;
    if (this.t - this.lastGroanAt < 0.4) return;
    this.lastGroanAt = this.t;
    const f = 90 + Math.random() * 70;
    const pan = (Math.random() - 0.5) * 0.7;
    this.blip("sawtooth", f, 0.5, 0.06, { sweepTo: f * 0.7, pan, detune: (Math.random() - 0.5) * 30 });
    this.noise(0.4, 0.04, "bandpass", 300, 4, undefined, { pan });
  }

  /** Player takes damage. */
  hurt() {
    if (!this.ok()) return;
    this.blip("sawtooth", 200, 0.18, 0.2, { sweepTo: 80 });
    this.noise(0.12, 0.12, "lowpass", 400);
    this.sub(90, 0.16, 0.14); // gut-punch thump
  }

  /** Big explosion (bomber/grenade). Routed to reverb for a sense of space. */
  boom() {
    if (!this.ok()) return;
    if (this.t - this.lastBoomAt < 0.06) return; // throttle multi-explosion frames
    this.lastBoomAt = this.t;
    this.noise(0.5, 0.5, "lowpass", 800, 1, 60, { dest: this.wet(0.18) });
    this.noise(0.07, 0.45, "highpass", 1800, 0.6); // initial crack/debris
    this.blip("sine", 90, 0.4, 0.3, { sweepTo: 30 });
    this.sub(70, 0.45, 0.4); // earth-shaking low end
  }

  /** Reward jingle for pickups / power-ups (rising arpeggio). */
  powerup() {
    if (!this.ok()) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => {
      this.blip("square", n, 0.12, 0.16, { delay: i * 0.06 });
      this.blip("triangle", n * 2, 0.08, 0.05, { delay: i * 0.06 }); // airy overtone
    });
  }

  /**
   * Rarity-tiered pickup chime. `tier` 0..4 (common→legendary) raises the root
   * pitch and the sparkle so rarer drops sound distinctly more exciting. Rarer
   * tiers also tap the reverb for a touch of grandeur. NON-CASHABLE feedback.
   */
  pickup(tier = 0) {
    if (!this.ok()) return;
    const t = Math.max(0, Math.min(4, Math.floor(tier)));
    const root = 523 * this.semi(t * 2); // climb a whole-tone per tier
    const w = t >= 3 ? this.wet(0.2) : undefined; // epic+ get a little space
    // a short rising major-ish triad, longer/brighter for higher tiers
    const steps = 3 + t; // more notes the rarer it is
    for (let i = 0; i < steps; i++) {
      const n = root * this.semi(i * 4); // major-third stack
      this.blip("triangle", n * this.vary(20), 0.12, 0.13, { delay: i * 0.05, dest: w });
      this.blip("square", n * 2, 0.05, 0.03, { delay: i * 0.05 }); // glint
    }
    if (t >= 4) this.blip("sine", root * 4, 0.3, 0.08, { delay: steps * 0.05, dest: w }); // legendary shimmer tail
  }

  /** Buy / interaction confirm. */
  buy() {
    if (!this.ok()) return;
    this.blip("square", 660, 0.08, 0.16);
    this.blip("triangle", 1320, 0.06, 0.06);
    this.blip("square", 990, 0.1, 0.14, { delay: 0.07 });
  }

  /** Denied (can't afford). */
  deny() {
    if (!this.ok()) return;
    this.blip("square", 220, 0.12, 0.16, { sweepTo: 160 });
    this.blip("square", 165, 0.12, 0.1, { sweepTo: 120, delay: 0.02 }); // sour minor flavor
  }

  /** New round sting (descending then resolving). Reverb-fed for grandeur. */
  roundStart() {
    if (!this.ok()) return;
    const notes = [392, 523, 659];
    const w = this.wet(0.2);
    notes.forEach((n, i) => {
      this.blip("triangle", n, 0.3, 0.18, { delay: i * 0.12, dest: w });
      this.blip("square", n * 2, 0.14, 0.04, { delay: i * 0.12 });
    });
    this.noise(0.6, 0.06, "bandpass", 200, 2);
    this.sub(60, 0.4, 0.16); // a low swell underneath
  }

  /** Revive complete / clutch. Warm, hopeful, with a touch of space. */
  revive() {
    if (!this.ok()) return;
    const notes = [330, 440, 554, 659];
    const w = this.wet(0.25);
    notes.forEach((n, i) => {
      this.blip("sine", n, 0.22, 0.16, { delay: i * 0.08, dest: w });
      this.blip("triangle", n, 0.22, 0.06, { delay: i * 0.08 });
    });
  }

  /** UI click. */
  ui() {
    if (!this.ok()) return;
    this.blip("square", 880, 0.05, 0.1);
  }

  /** Level-up fanfare: a bright rising arpeggio that resolves up an octave. */
  levelUp() {
    if (!this.ok()) return;
    const notes = [523, 659, 784, 1047, 1319];
    const w = this.wet(0.22);
    notes.forEach((n, i) => {
      this.blip("triangle", n, 0.22, 0.16, { delay: i * 0.07, dest: w });
      this.blip("square", n * 2, 0.1, 0.05, { delay: i * 0.07 }); // shimmer overtone
    });
    this.noise(0.5, 0.05, "bandpass", 1200, 3); // soft sparkle wash
    this.sub(110, 0.3, 0.14); // body so it lands with weight
  }

  // ---- pet ability casts ----

  /**
   * Distinct, satisfying signature-ability cast sounds. `power` (0..1-ish, but
   * clamped) makes the cast bigger/lower/longer for stronger pets — pass e.g.
   * `ability(kind, ab.power / 200)`. A short throttle prevents two pets casting
   * the SAME kind on the same frame from doubling up harshly; different kinds
   * always play.
   */
  ability(
    kind: "nova" | "volley" | "chain" | "meteor" | "smite" | "execute" | "jackpot" | "obliterate",
    power = 1,
  ) {
    if (!this.ok()) return;
    if (kind === this.lastAbilityKind && this.t - this.lastAbilityAt < 0.05) return;
    this.lastAbilityAt = this.t;
    this.lastAbilityKind = kind;
    const p = Math.max(0, Math.min(1.6, power)); // normalized strength
    switch (kind) {
      case "nova":
        return this.abNova(p);
      case "volley":
        return this.abVolley(p);
      case "chain":
        return this.abChain(p);
      case "meteor":
        return this.abMeteor(p);
      case "smite":
        return this.abSmite(p);
      case "execute":
        return this.abExecute(p);
      case "jackpot":
        return this.abJackpot(p);
      case "obliterate":
        return this.abObliterate(p);
    }
  }

  /** nova — radiant outward whoosh + shimmer burst. */
  private abNova(p: number) {
    const w = this.wet(0.25);
    // rising filtered-noise whoosh expanding outward
    this.noise(0.45 + p * 0.1, 0.22, "bandpass", 400, 1.2, 2600 + p * 1200, { dest: w });
    this.sub(120 - p * 30, 0.3, 0.18); // soft outward push
    // shimmer: bright triangle chord ringing out
    const chord = [784, 988, 1175, 1568];
    chord.forEach((n, i) =>
      this.blip("triangle", n * (1 - p * 0.08), 0.4, 0.09, { delay: i * 0.015, dest: w, pan: (i - 1.5) * 0.3 }),
    );
  }

  /** volley — rapid mechanical multi-shot rattle. */
  private abVolley(p: number) {
    const shots = 7 + Math.round(p * 4);
    for (let i = 0; i < shots; i++) {
      const d = i * 0.035;
      const pan = (Math.random() - 0.5) * 0.6;
      this.noise(0.04, 0.28, "highpass", 1600 + Math.random() * 800, 0.6, undefined, { delay: d, pan });
      this.blip("square", 300 + Math.random() * 120, 0.05, 0.1, { delay: d, sweepTo: 140, pan });
    }
    this.sub(90 - p * 20, 0.18, 0.12); // mechanical chassis thud
  }

  /** chain — electric zap arcing/crackle. */
  private abChain(p: number) {
    const w = this.wet(0.18);
    // detuned high squares = harsh electric buzz that arcs down
    this.blip("square", 2000 + p * 600, 0.18, 0.12, { sweepTo: 700, detune: 25, dest: w });
    this.blip("square", 2000 + p * 600, 0.18, 0.1, { sweepTo: 680, detune: -25 });
    // crackle: stuttered high-passed noise zaps
    for (let i = 0; i < 5; i++) {
      this.noise(0.03, 0.18, "highpass", 3000 + Math.random() * 2000, 0.5, undefined, {
        delay: i * 0.04 * Math.random(),
        pan: (Math.random() - 0.5) * 0.8,
      });
    }
    this.sub(70, 0.12, 0.1);
  }

  /** meteor — whistling descent into layered impacts/booms. */
  private abMeteor(p: number) {
    const w = this.wet(0.2);
    // falling whistle
    this.blip("sine", 1800, 0.5, 0.1, { sweepTo: 180 });
    this.noise(0.5, 0.08, "bandpass", 1600, 6, 300); // wind/whistle hiss
    // staggered impacts at the bottom
    const impacts = 3 + Math.round(p);
    for (let i = 0; i < impacts; i++) {
      const d = 0.45 + i * 0.07;
      const pan = (Math.random() - 0.5) * 0.7;
      this.noise(0.35, 0.4, "lowpass", 700, 1, 60, { delay: d, dest: i === 0 ? w : undefined, pan });
      this.blip("sine", 80, 0.3, 0.22, { delay: d, sweepTo: 30, pan });
    }
    this.sub(55 - p * 12, 0.4, 0.32);
  }

  /** smite — heavenly choir-ish swell into a thunderous hit. */
  private abSmite(p: number) {
    const w = this.wet(0.35);
    // choir swell: stacked detuned saws through a soft lowpass-ish chord
    const chord = [392, 523, 659, 784];
    chord.forEach((n, i) => {
      this.blip("sawtooth", n, 0.4, 0.06, { dest: w, detune: -6, pan: (i - 1.5) * 0.25 });
      this.blip("sawtooth", n, 0.4, 0.06, { dest: w, detune: 6, pan: (i - 1.5) * 0.25 });
    });
    // thunderous downstroke after the swell
    const d = 0.32;
    this.noise(0.5, 0.5, "lowpass", 900, 1, 60, { delay: d, dest: w });
    this.blip("sine", 110, 0.4, 0.3, { delay: d, sweepTo: 40 });
    this.sub(60 - p * 14, 0.45, 0.34);
  }

  /** execute — dark reaper "schwing" + low ominous hit. */
  private abExecute(p: number) {
    const w = this.wet(0.3);
    // metallic schwing: fast up-then-down filtered noise sweep
    this.noise(0.18, 0.3, "bandpass", 1200, 8, 5000, { pan: -0.3 });
    this.noise(0.18, 0.26, "bandpass", 5000, 8, 900, { delay: 0.06, pan: 0.3 });
    // ominous low drone underneath
    this.blip("sawtooth", 110 - p * 20, 0.5, 0.14, { sweepTo: 45, detune: 8, dest: w });
    this.blip("sawtooth", 110 - p * 20, 0.5, 0.12, { sweepTo: 45, detune: -8 });
    // the kill thud
    this.sub(48 - p * 10, 0.4, 0.34);
    this.noise(0.3, 0.2, "lowpass", 400, 1, 50, { delay: 0.12, dest: w });
  }

  /** jackpot — bright cascading coins / cash-register sparkle arpeggio. */
  private abJackpot(p: number) {
    const w = this.wet(0.2);
    // cash-register "ka-ching" pair
    this.blip("square", 1568, 0.07, 0.14);
    this.blip("square", 2093, 0.12, 0.14, { delay: 0.07, dest: w });
    // cascade of bright coin pings (pentatonic so it always sounds happy)
    const scale = [1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637];
    const coins = 8 + Math.round(p * 4);
    for (let i = 0; i < coins; i++) {
      const n = scale[i % scale.length] * (i >= scale.length ? 2 : 1);
      this.blip("triangle", n, 0.12, 0.09, { delay: 0.1 + i * 0.045, dest: w, pan: (Math.random() - 0.5) * 0.6 });
      this.blip("square", n * 2, 0.05, 0.03, { delay: 0.1 + i * 0.045 }); // glint
    }
  }

  /** obliterate — CINEMATIC, earth-shattering Mythic detonation with long tail. */
  private abObliterate(p: number) {
    const w = this.wet(0.5); // big wet send for the cinematic tail
    // pre-charge: a rising whine that builds tension
    this.blip("sawtooth", 200, 0.35, 0.1, { sweepTo: 1400, detune: 10 });
    this.blip("sawtooth", 200, 0.35, 0.08, { sweepTo: 1380, detune: -10 });
    // THE detonation
    const d = 0.34;
    this.noise(0.9, 0.6, "lowpass", 1000, 1, 50, { delay: d, dest: w });
    this.noise(0.1, 0.6, "highpass", 2200, 0.5, undefined, { delay: d }); // shrapnel crack
    this.blip("sine", 80, 0.8, 0.4, { delay: d, sweepTo: 24 });
    // massive layered sub-bass — the earth-shattering body
    this.sub(45 - p * 12, 0.9, 0.5);
    this.sub(30 - p * 8, 1.1, 0.4);
    // long rumbling aftershock fed entirely to reverb
    this.noise(0.7, 0.18, "lowpass", 220, 1, 50, { delay: d + 0.25, dest: w });
  }

  // ---- ambient music: a slow two-oscillator drone that intensifies by round ----
  startMusic(intensity = 0) {
    if (!this.ok() || !this.musicGain) return;
    this.stopMusic();
    const ctx = this.ctx!;
    const roots = [55, 82.4]; // A1 + E2 drone
    for (const r of roots) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = r;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 200 + intensity * 600;
      osc.connect(lp);
      lp.connect(this.musicGain);
      osc.start();
      this.musicOsc.push(osc);
    }
    // gentle fade-in
    this.musicGain.gain.cancelScheduledValues(this.t);
    this.musicGain.gain.setValueAtTime(0.0001, this.t);
    this.musicGain.gain.exponentialRampToValueAtTime(0.08 + intensity * 0.05, this.t + 2);
  }

  /** Nudge the drone's loudness/brightness as rounds escalate. */
  setIntensity(intensity: number) {
    if (!this.musicGain) return;
    this.musicGain.gain.setTargetAtTime(0.08 + Math.min(1, intensity) * 0.07, this.t, 1.5);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    for (const o of this.musicOsc) {
      try {
        o.stop();
      } catch {
        /* already stopped */
      }
    }
    this.musicOsc = [];
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(0.0001, this.t, 0.4);
  }
}
